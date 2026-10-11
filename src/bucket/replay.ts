// Sends an assignment queued from the Budget tab to Firefly III.
//
// One operation carries EVERY entry of the change, and every entry is an ABSOLUTE amount. Both
// matter for correctness, not convenience:
//
//  - "move 50 from Dining Out to Groceries" must not be two queued operations. If the decrement
//    landed and the increment failed, money would vanish from the budget with nothing left in the
//    queue to put it back. One operation, both writes, one failure.
//  - absolute amounts converge. A retry after a lost answer re-sends what the envelope should hold
//    rather than another delta, so landing twice is the same as landing once.
//
// Each entry's limit id is recorded into the queued payload as soon as FF3 gives it (the same trick
// as replaySavePlanned's `billId`), so a retry PUTs the limit it already made instead of POSTing a
// second one. If even that was lost, the 422 fallback below re-reads and switches to a PUT.
import { eq } from 'drizzle-orm';
import { FF3RequestError, type FF3Client } from '../api/ff3/client';
import { compareDecimal } from '../api/ff3/decimal';
import { outboxOperations } from '../db/schema';
import type { OutboxDb } from '../sync/outbox';
import { writePayload } from '../sync/payloadJson';
import { limitWrite, limitsPath } from './limitWrite';
import { cachedLimit, storeBucketObject } from './objects';

export interface SetBudgetLimitsEntry {
  budgetId: string;
  /** Absolute: what this envelope should hold for the period when the operation has landed. */
  amount: string;
  /** Recorded as FF3 answers, so a retry updates rather than creates. */
  limitId?: string | null;
}

export interface SetBudgetLimitsPayload {
  periodStart: string;
  periodEnd: string;
  currencyCode: string;
  /** One entry = assign, two = move, many = auto-fill. */
  entries: SetBudgetLimitsEntry[];
}

type LimitRead = { data?: { id?: string | number; attributes?: Record<string, unknown> } };
type LimitList = { data?: { id?: string | number; attributes?: Record<string, unknown> }[] };

/** The limit FF3 holds for this budget and period right now, straight from the server. */
async function serverLimit(
  client: FF3Client,
  budgetId: string,
  periodStart: string,
  periodEnd: string,
): Promise<{ id: string; attributes: Record<string, unknown> } | null> {
  const response = await client.request<LimitList>(
    `${limitsPath(budgetId)}?start=${periodStart}&end=${periodEnd}`,
  );
  const found = (response?.data ?? []).find(
    (limit) => String(limit.attributes?.start ?? '').slice(0, 10) === periodStart,
  );
  return found?.id != null ? { id: String(found.id), attributes: found.attributes ?? {} } : null;
}

export async function replaySetBudgetLimits(
  db: OutboxDb,
  client: FF3Client,
  opId: string,
  payload: SetBudgetLimitsPayload,
): Promise<void> {
  const p: SetBudgetLimitsPayload = { ...payload, entries: payload.entries.map((e) => ({ ...e })) };
  const remember = () =>
    db
      .update(outboxOperations)
      .set({ payloadJson: writePayload(p) })
      .where(eq(outboxOperations.id, opId));

  for (const entry of p.entries) {
    // The id this operation already recorded, then the last pull's, then the server's own answer.
    // The last step is what makes a limit created in FF3's web UI since the pull an update rather
    // than a 422 on every retry.
    let limitId = entry.limitId ?? null;
    let currentAmount: string | null = null;
    if (!limitId) {
      const cached = await cachedLimit(db, entry.budgetId, p.periodStart);
      if (cached?.id) {
        limitId = String(cached.id);
        currentAmount = typeof cached.amount === 'string' ? cached.amount : null;
      }
    }
    if (!limitId) {
      const fresh = await serverLimit(client, entry.budgetId, p.periodStart, p.periodEnd);
      if (fresh) {
        limitId = fresh.id;
        currentAmount =
          typeof fresh.attributes.amount === 'string' ? fresh.attributes.amount : null;
        entry.limitId = limitId;
        await remember();
      }
    }

    const verdict = limitWrite({
      budgetId: entry.budgetId,
      wanted: entry.amount,
      limitId,
      currentAmount,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      currencyCode: p.currencyCode,
    });
    if (verdict.method === 'none') continue;

    if (verdict.method === 'DELETE') {
      await deleteIfPresent(client, verdict.path);
      entry.limitId = null;
      await remember();
      await storeBucketObject(db, 'budget_limit', entry.budgetId, p.periodStart, null);
      continue;
    }

    let answer: LimitRead;
    try {
      answer = await client.request<LimitRead>(verdict.path, {
        method: verdict.method,
        body: JSON.stringify(verdict.body),
      });
    } catch (err) {
      // `limit_exists`: an earlier attempt's POST landed and only its answer was lost. Read the
      // limit FF3 made and update that one — matched by name of failure, not by status code alone,
      // but a 422 on a POST to this path has no other cause worth retrying differently.
      const existing =
        verdict.method === 'POST' && err instanceof FF3RequestError && err.status === 422
          ? await serverLimit(client, entry.budgetId, p.periodStart, p.periodEnd)
          : null;
      if (!existing) throw err;
      entry.limitId = existing.id;
      await remember();
      answer = await client.request<LimitRead>(limitsPath(entry.budgetId, existing.id), {
        method: 'PUT',
        body: JSON.stringify({ amount: entry.amount }),
      });
    }

    const id = answer?.data?.id;
    if (id != null && String(id) !== entry.limitId) {
      entry.limitId = String(id);
      await remember();
    }
    // The screen updates off FF3's own answer rather than waiting for the next sync.
    if (answer?.data?.attributes)
      await storeBucketObject(db, 'budget_limit', entry.budgetId, p.periodStart, {
        ...answer.data.attributes,
        id: String(id ?? entry.limitId ?? ''),
      });
  }
}

export interface SetPiggyAmountPayload {
  piggyId: string;
  /** The asset account the money sits in: FF3 writes a piggy's amount per linked account. */
  accountId: string;
  /** Absolute `accounts[].current_amount`, so a replay converges. */
  amount: string;
  /** The piggy's `updated_at` when the edit started, for the conflict check. */
  expectedUpdatedAt?: string;
}

/**
 * Funds or empties a sinking fund.
 *
 * Absolute, so a retry converges — but this is a read-modify-write against a field Firefly III's
 * own web UI can change too, so it is conflict-checked first and fails with a readable message
 * rather than overwriting someone's change (the same rule as a transaction edit).
 *
 * Three details of FF3 6.7.7 shape the request:
 *  - the `accounts[]` form is the only one that can EMPTY a fund. The top-level `current_amount` is
 *    `IsValidPositiveAmount` (> 0); `accounts.*.current_amount` is `IsValidZeroOrMoreAmount(true)`.
 *  - `LessThanPiggyTarget` is a no-op stub, so the validator will not stop an over-target amount —
 *    but `ModifiesPiggyBanks::setCurrentAmount` silently CLAMPS it. Send what fits, or the saved
 *    amount will not be what was asked for.
 *  - `accounts.*.current_amount` also runs `IsEnoughInAccounts`: you cannot put aside more than the
 *    linked account actually holds. That 422 is a message for the user, not something to retry.
 */
export async function replaySetPiggyAmount(
  db: OutboxDb,
  client: FF3Client,
  payload: SetPiggyAmountPayload,
): Promise<void> {
  const current = await client.request<{
    data?: { attributes?: Record<string, unknown> };
  }>(`/v1/piggy-banks/${payload.piggyId}`);
  const attributes = current?.data?.attributes ?? {};
  const serverUpdatedAt = typeof attributes.updated_at === 'string' ? attributes.updated_at : null;
  if (
    payload.expectedUpdatedAt &&
    serverUpdatedAt &&
    serverUpdatedAt !== payload.expectedUpdatedAt
  ) {
    throw new Error(
      `${String(attributes.name ?? 'This fund')} changed in Firefly III since you edited it — open it and set the amount again`,
    );
  }

  // FF3 would clamp an over-target amount to the target without saying so; clamp it here instead,
  // so what is stored in the cache below is what FF3 actually holds.
  const target = typeof attributes.target_amount === 'string' ? attributes.target_amount : null;
  const amount =
    target && compareDecimal(target, '0') > 0 && compareDecimal(payload.amount, target) > 0
      ? target
      : payload.amount;

  const answer = await client.request<{ data?: { attributes?: Record<string, unknown> } }>(
    `/v1/piggy-banks/${payload.piggyId}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        accounts: [{ account_id: payload.accountId, current_amount: amount }],
      }),
    },
  );
  if (answer?.data?.attributes)
    await storeBucketObject(db, 'piggy', payload.piggyId, null, answer.data.attributes);
}

async function deleteIfPresent(client: FF3Client, path: string): Promise<void> {
  try {
    await client.request(path, { method: 'DELETE' });
  } catch (err) {
    // Already gone (FF3's web UI, or an earlier attempt of this very operation): that's the goal.
    if (!(err instanceof FF3RequestError && err.status === 404)) throw err;
  }
}
