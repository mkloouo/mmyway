import { eq, and } from 'drizzle-orm';
import { normkey } from './normkey';
import { aliases } from '../db/schema';
import type { OutboxDb } from '../sync/outbox';
import type { Draft } from '../inbox/draft';

/**
 * Aliases map a payee name as it arrives (a receipt's printed merchant, a bank's legal name, a
 * shorthand) to the FF3 payee it should book to. Only payees: account, budget and currency
 * aliases were never read anywhere and are no longer offered.
 */
export const PAYEE = 'payee';

export interface Alias {
  id: string;
  kind: string;
  normalizedKey: string;
  rawInput: string;
  targetId: string | null;
  targetName: string;
}

export type AliasMatch = { matched: true; alias: Alias } | { matched: false; normalizedKey: string };

export async function matchAlias(db: OutboxDb, kind: string, rawInput: string): Promise<AliasMatch> {
  const key = normkey(rawInput);
  const rows = await db.select().from(aliases).where(and(eq(aliases.kind, kind), eq(aliases.normalizedKey, key)));
  const exact = rows[0];
  if (!exact) return { matched: false, normalizedKey: key };
  return { matched: true, alias: exact as Alias };
}

export async function upsertAlias(db: OutboxDb, input: { kind: string; rawInput: string; targetId: string | null; targetName: string }): Promise<void> {
  const key = normkey(input.rawInput);
  await db.insert(aliases).values({
    id: `${input.kind}:${key}`,
    kind: input.kind,
    normalizedKey: key,
    rawInput: input.rawInput,
    targetId: input.targetId,
    targetName: input.targetName,
    createdAt: new Date().toISOString(),
  }).onConflictDoUpdate({
    target: aliases.id,
    set: { rawInput: input.rawInput, targetId: input.targetId, targetName: input.targetName },
  });
}

export async function removeAlias(db: OutboxDb, kind: string, rawInput: string): Promise<void> {
  const key = normkey(rawInput);
  await db.delete(aliases).where(and(eq(aliases.kind, kind), eq(aliases.normalizedKey, key)));
}

/** The free-text payee end of a draft: a withdrawal's destination, a deposit's source. */
export function draftPayeeName(draft: Draft): string | undefined {
  if (draft.type === 'withdrawal') return draft.destinationName;
  if (draft.type === 'deposit') return draft.sourceName;
  return undefined;
}

/**
 * Points a draft's payee at an alias target, keeping the text it replaced in `payeeReadAs` so the
 * draft screen can say where the name came from. The stored id is an expense account, so it is
 * only used for a withdrawal; a deposit's payer is sent by name and FF3 resolves it.
 */
export function withPayeeAlias(draft: Draft, alias: Pick<Alias, 'targetId' | 'targetName'>): Draft {
  const raw = draftPayeeName(draft);
  const readAs = raw && raw !== alias.targetName ? raw : undefined;
  if (draft.type === 'withdrawal') {
    return { ...draft, destinationName: alias.targetName, destinationId: alias.targetId ?? undefined, isNewPayee: false, payeeReadAs: readAs };
  }
  if (draft.type === 'deposit') {
    return { ...draft, sourceName: alias.targetName, sourceId: undefined, isNewPayee: false, payeeReadAs: readAs };
  }
  return draft;
}

/** Applies a payee alias to a draft whose payee is still free text (a receipt's merchant); otherwise returns it unchanged. */
export async function resolvePayeeAlias(db: OutboxDb, draft: Draft): Promise<Draft> {
  const raw = draftPayeeName(draft);
  if (!draft.isNewPayee || !raw?.trim()) return draft;
  const match = await matchAlias(db, PAYEE, raw);
  return match.matched ? withPayeeAlias(draft, match.alias) : draft;
}

/**
 * Learns from a correction: the user replaced `rawInput` (what a receipt read, or a name typed as
 * new) with `targetName`, so the next time that text arrives it books to the same payee. Stored
 * by name only — the target may be a payee FF3 hasn't created yet. Returns false when there is
 * nothing to learn (blank, or the same name spelled differently).
 */
export async function rememberPayeeAlias(db: OutboxDb, rawInput: string, targetName: string): Promise<boolean> {
  const key = normkey(rawInput);
  if (!key || key === normkey(targetName)) return false;
  await upsertAlias(db, { kind: PAYEE, rawInput: rawInput.trim(), targetId: null, targetName });
  return true;
}
