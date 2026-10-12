import { eq } from 'drizzle-orm';
import { normkey } from './normkey';
import { payeeAliases, referenceAccounts } from '../db/schema';
import type { OutboxDb } from '../sync/outbox';
import type { Draft } from '../inbox/draft';

type AliasMatch =
  { matched: true; payeeName: string; alias: string } | { matched: false; normalizedKey: string };

interface PayeeAliasGroup {
  payeeName: string;
  aliases: {
    id: string;
    alias: string;
    createdAt: string;
  }[];
}

/**
 * Matches raw input against known payee aliases (N aliases -> 1 true payee).
 * Uses normkey for accent-, case-, and punctuation-insensitive matching.
 */
export async function matchPayeeAlias(db: OutboxDb, rawInput: string): Promise<AliasMatch> {
  const key = normkey(rawInput);
  if (!key) return { matched: false, normalizedKey: '' };

  const rows = await db.select().from(payeeAliases).where(eq(payeeAliases.normalizedAlias, key));

  const exact = rows[0];
  if (!exact) return { matched: false, normalizedKey: key };
  return { matched: true, payeeName: exact.payeeName, alias: exact.alias };
}

/**
 * Associates an alias variation with a true canonical payee.
 * N aliases can point to the same true payee.
 * Returns false if input is empty or alias matches the payee name already.
 */
export async function rememberPayeeAlias(
  db: OutboxDb,
  rawAlias: string,
  truePayeeName: string,
): Promise<boolean> {
  const aliasTrimmed = rawAlias.trim();
  const payeeTrimmed = truePayeeName.trim();
  const key = normkey(aliasTrimmed);
  const payeeKey = normkey(payeeTrimmed);

  if (!key || !payeeKey || key === payeeKey) return false;

  await db
    .insert(payeeAliases)
    .values({
      id: key,
      alias: aliasTrimmed,
      normalizedAlias: key,
      payeeName: payeeTrimmed,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: payeeAliases.id,
      set: {
        alias: aliasTrimmed,
        payeeName: payeeTrimmed,
      },
    });

  return true;
}

/** Removes a single alias by its raw string. */
export async function removePayeeAlias(db: OutboxDb, rawAlias: string): Promise<void> {
  const key = normkey(rawAlias);
  if (!key) return;
  await db.delete(payeeAliases).where(eq(payeeAliases.id, key));
}

/** Removes all aliases pointing to a specific true payee. */
export async function removePayeeGroup(db: OutboxDb, truePayeeName: string): Promise<void> {
  await db.delete(payeeAliases).where(eq(payeeAliases.payeeName, truePayeeName.trim()));
}

/** Renames the canonical payee for all of its aliases. */
export async function renamePayeeGroup(
  db: OutboxDb,
  oldPayeeName: string,
  newPayeeName: string,
): Promise<void> {
  const target = newPayeeName.trim();
  if (!target) return;
  await db
    .update(payeeAliases)
    .set({ payeeName: target })
    .where(eq(payeeAliases.payeeName, oldPayeeName.trim()));
}

/**
 * Returns all aliases grouped by their 1 true canonical payee.
 * Ordered alphabetically by payee name.
 */
export async function getPayeesWithAliases(db: OutboxDb): Promise<PayeeAliasGroup[]> {
  const rows = await db.select().from(payeeAliases);
  const groups = new Map<string, PayeeAliasGroup['aliases']>();

  for (const row of rows) {
    const list = groups.get(row.payeeName) ?? [];
    list.push({ id: row.id, alias: row.alias, createdAt: row.createdAt });
    groups.set(row.payeeName, list);
  }

  return Array.from(groups.entries())
    .map(([payeeName, aliases]) => ({
      payeeName,
      aliases: aliases.sort((a, b) => a.alias.localeCompare(b.alias)),
    }))
    .sort((a, b) => a.payeeName.localeCompare(b.payeeName));
}

/** The free-text payee end of a draft: a withdrawal's destination, a deposit's source. */
function draftPayeeName(draft: Draft): string | undefined {
  if (draft.type === 'withdrawal') return draft.destinationName;
  if (draft.type === 'deposit') return draft.sourceName;
  return undefined;
}

/**
 * Points a draft's payee at an alias target, keeping the text it replaced in `payeeReadAs` so the
 * draft screen can show what was originally read from the receipt.
 */
function withPayeeAlias(draft: Draft, alias: { payeeName: string; rawInput?: string }): Draft {
  const raw = alias.rawInput ?? draftPayeeName(draft);
  const readAs = raw && raw !== alias.payeeName ? raw : undefined;

  if (draft.type === 'withdrawal') {
    return {
      ...draft,
      destinationName: alias.payeeName,
      destinationId: undefined,
      isNewPayee: false,
      payeeReadAs: readAs,
    };
  }
  if (draft.type === 'deposit') {
    return {
      ...draft,
      sourceName: alias.payeeName,
      sourceId: undefined,
      isNewPayee: false,
      payeeReadAs: readAs,
    };
  }
  return draft;
}

/**
 * Applies a payee alias to a draft whose payee is still free text (a receipt's merchant); otherwise
 * returns it unchanged. Falls back to a direct name match against reference_accounts (the already
 * locally-synced account list, same local-first check FF3Service.accounts.resolve does) so a
 * merchant the user renamed/merged in FF3 itself — never hand-corrected into an alias here — isn't
 * flagged "a new account will be created" forever.
 */
export async function resolvePayeeAlias(db: OutboxDb, draft: Draft): Promise<Draft> {
  const raw = draftPayeeName(draft);
  if (!draft.isNewPayee || !raw?.trim()) return draft;

  const match = await matchPayeeAlias(db, raw);
  if (match.matched) {
    return withPayeeAlias(draft, { payeeName: match.payeeName, rawInput: raw });
  }

  const payeeType =
    draft.type === 'withdrawal' ? 'expense' : draft.type === 'deposit' ? 'revenue' : null;
  if (!payeeType) return draft;
  const trimmed = raw.trim();
  const accounts = await db
    .select()
    .from(referenceAccounts)
    .where(eq(referenceAccounts.type, payeeType));
  const account =
    accounts.find((a) => a.name === trimmed) ??
    accounts.find((a) => a.name.toLowerCase() === trimmed.toLowerCase());
  if (!account) return draft;
  return draft.type === 'withdrawal'
    ? { ...draft, destinationId: account.id, isNewPayee: false }
    : { ...draft, sourceId: account.id, isNewPayee: false };
}
