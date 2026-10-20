import { and, eq, inArray } from 'drizzle-orm';
import { FF3RequestError, UPLOAD_TIMEOUT_MS } from '../api/ff3/client';
import type { FF3Client } from '../api/ff3/client';
import { sanitizeSplit } from '../api/ff3/sanitize';
import type { TransactionRead, TransactionSplit } from '../api/ff3/types';
import type { TransactionType } from '../transactions/fromFf3';
import { cachedTransactions, outboxOperations } from '../db/schema';
import * as schema from '../db/schema';
import { forgetAttachmentFile } from '../receipt/attachmentFiles';
import { deletePersistedReceiptImage } from '../receipt/imageFiles';
import { accountResolver, withAccountIds } from './accountIds';
import { duplicateOf, internalReferenceFor, splitReference } from './outboxErrors';
import { recordCreated, returnToInbox } from './outboxQueue';
import type {
  AttachReceiptPayload,
  CreateTransactionPayload,
  DeleteAttachmentPayload,
  DeleteTransactionPayload,
  OutboxDb,
  OutboxRow,
  ReplayContext,
  ReplayOutcome,
  UpdateTransactionPayload,
} from './outboxTypes';
import { readPayload, writePayload } from './payloadJson';
import { receiptFilename } from './receiptPruning';
import { cachedRowFromGroup } from './referenceData';
import { isUnsent } from './unsent';

async function conflictingUpdatedAt(
  db: OutboxDb,
  groupId: string,
  expectedUpdatedAt: string,
): Promise<string | null> {
  const current = (
    await db.select().from(cachedTransactions).where(eq(cachedTransactions.groupId, groupId))
  )[0];
  return current && current.updatedAt !== expectedUpdatedAt ? current.updatedAt : null;
}

type ServerCopy =
  | { status: 'present'; updatedAt: string | null; group: TransactionRead | null }
  | { status: 'gone' };

async function serverCopy(client: FF3Client, groupId: string): Promise<ServerCopy> {
  try {
    const response = await client.request<{ data?: TransactionRead }>(
      `/v1/transactions/${groupId}`,
    );
    const updatedAt =
      (response?.data?.attributes as { updated_at?: string } | undefined)?.updated_at ?? null;
    return { status: 'present', updatedAt, group: response?.data ?? null };
  } catch (err) {
    if (err instanceof FF3RequestError && err.status === 404) return { status: 'gone' };
    throw err;
  }
}

async function recoverOwnDuplicate(
  client: FF3Client,
  id: string,
  reference: string,
): Promise<TransactionRead | null> {
  for (const path of [`/v1/transactions/${id}`, `/v1/transaction-journals/${id}`]) {
    try {
      const found = await client.request<{ data: TransactionRead }>(path);
      if (splitReference(found?.data) === reference) return found.data;
    } catch (err) {
      if (!(err instanceof FF3RequestError && err.status === 404)) throw err;
    }
  }
  return null;
}

async function markConflict(db: OutboxDb, id: string): Promise<void> {
  await db
    .update(outboxOperations)
    .set({ status: 'failed', lastError: 'conflict' })
    .where(eq(outboxOperations.id, id));
}

async function rebaseLaterEdits(
  db: OutboxDb,
  groupId: string,
  previous: string,
  next: string | null,
): Promise<void> {
  if (!next || next === previous) return;
  await db
    .update(cachedTransactions)
    .set({ updatedAt: next })
    .where(eq(cachedTransactions.groupId, groupId));
  const later = await db
    .select()
    .from(outboxOperations)
    .where(
      and(
        isUnsent(),
        inArray(outboxOperations.kind, [
          'update_transaction',
          'recurring_review',
          'delete_transaction',
        ]),
      ),
    );
  for (const op of later) {
    const payload = readPayload<UpdateTransactionPayload | DeleteTransactionPayload>(
      op.kind,
      op.payloadJson,
    );
    if (payload.groupId !== groupId || payload.expectedUpdatedAt !== previous) continue;
    payload.expectedUpdatedAt = next;
    await db
      .update(outboxOperations)
      .set({ payloadJson: writePayload(payload) })
      .where(eq(outboxOperations.id, op.id));
  }
}

async function cachedTypeOf(db: OutboxDb, groupId: string): Promise<TransactionType | undefined> {
  const [row] = await db
    .select({ type: cachedTransactions.type })
    .from(cachedTransactions)
    .where(eq(cachedTransactions.groupId, groupId));
  return row?.type === 'withdrawal' || row?.type === 'deposit' || row?.type === 'transfer'
    ? row.type
    : undefined;
}

async function missingReferences(db: OutboxDb, splits: TransactionSplit[]): Promise<string[]> {
  const [accounts, categories, budgets] = await Promise.all([
    db.select({ id: schema.referenceAccounts.id }).from(schema.referenceAccounts),
    db.select({ name: schema.referenceCategories.name }).from(schema.referenceCategories),
    db.select({ id: schema.referenceBudgets.id }).from(schema.referenceBudgets),
  ]);
  const accountIds = new Set(accounts.map((a) => a.id));
  const categoryNames = new Set(categories.map((c) => c.name.toLowerCase()));
  const budgetIds = new Set(budgets.map((b) => b.id));
  const problems: string[] = [];
  for (const split of splits) {
    for (const [end, id] of [
      ['source', split.source_id],
      ['destination', split.destination_id],
    ] as const) {
      if (id && accountIds.size > 0 && !accountIds.has(String(id)))
        problems.push(`The ${end} account no longer exists in Firefly III — pick another.`);
    }
    if (
      split.category_name &&
      categoryNames.size > 0 &&
      !categoryNames.has(split.category_name.toLowerCase())
    ) {
      problems.push(
        `The category "${split.category_name}" no longer exists in Firefly III — pick another.`,
      );
    }
    if (split.budget_id && budgetIds.size > 0 && !budgetIds.has(String(split.budget_id)))
      problems.push('The budget no longer exists in Firefly III — pick another.');
  }
  return problems;
}

export async function replayCreateTransaction(
  ctx: ReplayContext,
  p: CreateTransactionPayload,
  row: OutboxRow,
): Promise<ReplayOutcome> {
  const { db, client } = ctx;
  const missing = await missingReferences(db, p.splits);
  if (missing.length > 0 && row.inboxItemId) {
    db.transaction((tx) => {
      returnToInbox(tx, row.inboxItemId!, missing.join(' '));
      tx.delete(outboxOperations).where(eq(outboxOperations.id, row.id)).run();
    });
    return 'returned';
  }
  const reference = internalReferenceFor(p.clientId);
  const resolve = accountResolver(client, db);
  const splits: TransactionSplit[] = [];
  for (const split of p.splits) splits.push(await withAccountIds(resolve, split));
  let created: TransactionRead;
  try {
    const response = await client.request<{ data: TransactionRead }>('/v1/transactions', {
      method: 'POST',
      body: JSON.stringify({
        error_if_duplicate_hash: true,
        ...(p.groupTitle ? { group_title: p.groupTitle } : {}),
        transactions: splits.map((split) =>
          sanitizeSplit({
            ...split,
            internal_reference:
              (split as { internal_reference?: string }).internal_reference ?? reference,
          }),
        ),
      }),
    });
    created = response.data;
  } catch (err) {
    const duplicateId = duplicateOf(err);
    const recovered = duplicateId
      ? await recoverOwnDuplicate(client, duplicateId, reference)
      : null;
    if (!recovered) throw err;
    created = recovered;
  }

  await recordCreated(db, row, created);
  return 'done';
}

export async function replayAttachReceipt(
  ctx: ReplayContext,
  p: AttachReceiptPayload,
  row: OutboxRow,
): Promise<ReplayOutcome> {
  const { db, client } = ctx;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { File } = require('expo-file-system');
  const file = new File(p.receiptImagePath);
  if (!file.exists) throw new Error(`receipt image is missing: ${p.receiptImagePath}`);
  const bytes: ArrayBuffer = await file.arrayBuffer();
  let attachmentId = p.attachmentId;
  if (!attachmentId) {
    const created = await client.request<{ data: { id: string } }>('/v1/attachments', {
      method: 'POST',
      body: JSON.stringify({
        filename: receiptFilename(p.receiptImagePath),
        attachable_type: 'TransactionJournal',
        attachable_id: p.transactionJournalId,
      }),
    });
    attachmentId = created.data.id;
    await db
      .update(outboxOperations)
      .set({ payloadJson: writePayload({ ...p, attachmentId }) })
      .where(eq(outboxOperations.id, row.id));
  }
  await client.request(`/v1/attachments/${attachmentId}/upload`, {
    method: 'POST',
    body: bytes,
    headers: { 'Content-Type': 'application/octet-stream' },
    timeoutMs: UPLOAD_TIMEOUT_MS,
  });
  await db.delete(outboxOperations).where(eq(outboxOperations.id, row.id));
  if (!row.inboxItemId) deletePersistedReceiptImage(p.receiptImagePath);
  return 'done';
}

export async function replayDeleteAttachment(
  ctx: ReplayContext,
  p: DeleteAttachmentPayload,
  row: OutboxRow,
): Promise<ReplayOutcome> {
  const { db, client } = ctx;
  try {
    await client.request(`/v1/attachments/${encodeURIComponent(p.attachmentId)}`, {
      method: 'DELETE',
    });
  } catch (err) {
    if (!(err instanceof FF3RequestError) || err.status !== 404) throw err;
  }
  forgetAttachmentFile(p.attachmentId);
  await db.delete(outboxOperations).where(eq(outboxOperations.id, row.id));
  return 'done';
}

export async function replayUpdateTransaction(
  ctx: ReplayContext,
  p: UpdateTransactionPayload | DeleteTransactionPayload,
  row: OutboxRow,
): Promise<ReplayOutcome> {
  const { db, client, opts = {} } = ctx;
  const isDelete = row.kind === 'delete_transaction';
  const resumed = !isDelete && !!(p as UpdateTransactionPayload).applied;
  if (p.expectedUpdatedAt && !resumed) {
    const cachedConflict = await conflictingUpdatedAt(db, p.groupId, p.expectedUpdatedAt);
    if (cachedConflict) {
      opts.onConflict?.({ id: row.id, payload: p }, cachedConflict);
      await markConflict(db, row.id);
      return 'conflict';
    }
  }
  const server: ServerCopy = resumed
    ? { status: 'present', updatedAt: null, group: null }
    : await serverCopy(client, p.groupId);
  if (server.status === 'gone') {
    if (!isDelete) throw new Error('the transaction no longer exists in Firefly III');
    await db.delete(cachedTransactions).where(eq(cachedTransactions.groupId, p.groupId));
    await db.delete(outboxOperations).where(eq(outboxOperations.id, row.id));
    return 'done';
  }
  if (p.expectedUpdatedAt && server.updatedAt && server.updatedAt !== p.expectedUpdatedAt) {
    const fresh = server.group ? cachedRowFromGroup(server.group, new Date().toISOString()) : null;
    try {
      if (!fresh) throw new Error('no server copy to store');
      await db
        .insert(cachedTransactions)
        .values(fresh)
        .onConflictDoUpdate({ target: cachedTransactions.groupId, set: fresh });
    } catch {
      await db
        .update(cachedTransactions)
        .set({ updatedAt: server.updatedAt })
        .where(eq(cachedTransactions.groupId, p.groupId));
    }
    opts.onConflict?.({ id: row.id, payload: p }, server.updatedAt);
    await markConflict(db, row.id);
    return 'conflict';
  }

  if (isDelete) {
    await client.request(`/v1/transactions/${p.groupId}`, { method: 'DELETE' });
    await db.delete(cachedTransactions).where(eq(cachedTransactions.groupId, p.groupId));
  } else {
    const u = p as UpdateTransactionPayload;
    let updated: { data?: TransactionRead } | null = null;
    if (!u.applied) {
      const resolve = accountResolver(client, db);
      const groupType = await cachedTypeOf(db, u.groupId);
      const transactions = [];
      for (const split of u.splits ?? [
        { transaction_journal_id: u.transactionJournalId, ...u.changes },
      ]) {
        const resolved = await withAccountIds(resolve, split, groupType);
        const sanitized = sanitizeSplit(resolved);
        if (Array.isArray(split.tags)) (sanitized as { tags?: string[] }).tags = split.tags;
        transactions.push(sanitized);
      }
      const body = u.splits
        ? { ...(u.groupTitle !== undefined ? { group_title: u.groupTitle } : {}), transactions }
        : { transactions };
      updated = await client.request<{ data?: TransactionRead }>(`/v1/transactions/${u.groupId}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
    }
    if (!u.applied && u.removedJournalIds?.length) {
      const landed = (updated?.data?.attributes as { updated_at?: string } | undefined)?.updated_at;
      if (u.expectedUpdatedAt && landed)
        await rebaseLaterEdits(db, u.groupId, u.expectedUpdatedAt, landed);
      const progressed: UpdateTransactionPayload = {
        ...u,
        applied: true,
        expectedUpdatedAt: landed ?? u.expectedUpdatedAt,
      };
      await db
        .update(outboxOperations)
        .set({ payloadJson: writePayload(progressed) })
        .where(eq(outboxOperations.id, row.id));
      Object.assign(u, progressed);
    }
    for (const journalId of u.removedJournalIds ?? []) {
      try {
        await client.request(`/v1/transaction-journals/${journalId}`, { method: 'DELETE' });
      } catch (err) {
        if (!(err instanceof FF3RequestError && err.status === 404)) throw err;
      }
    }
    const final = u.removedJournalIds?.length
      ? await client.request<{ data?: TransactionRead }>(`/v1/transactions/${u.groupId}`)
      : updated;
    const next =
      (final?.data?.attributes as { updated_at?: string } | undefined)?.updated_at ?? null;
    if (u.expectedUpdatedAt) await rebaseLaterEdits(db, u.groupId, u.expectedUpdatedAt, next);
    const fresh =
      u.splits && final?.data ? cachedRowFromGroup(final.data, new Date().toISOString()) : null;
    if (fresh)
      await db
        .insert(cachedTransactions)
        .values(fresh)
        .onConflictDoUpdate({ target: cachedTransactions.groupId, set: fresh });
  }
  await db.delete(outboxOperations).where(eq(outboxOperations.id, row.id));
  return 'done';
}
