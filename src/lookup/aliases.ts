import { eq, and } from 'drizzle-orm';
import { normkey } from './normkey';
import { aliases } from '../db/schema';
import type { OutboxDb } from '../sync/outbox';

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
