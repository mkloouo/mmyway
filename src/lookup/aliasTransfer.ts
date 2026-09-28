import { eq } from 'drizzle-orm';
import { aliases } from '../db/schema';
import { matchAlias, upsertAlias, PAYEE } from './aliases';
import type { OutboxDb } from '../sync/outbox';

export interface AliasExport {
  kind: string;
  rawInput: string;
  targetId: string | null;
  targetName: string;
}

export interface AliasCollision {
  kind: string;
  rawInput: string;
  existingTargetName: string;
  incomingTargetName: string;
}

export interface AliasImportResult {
  imported: number;
  collisions: AliasCollision[];
  /** Account, budget and currency aliases, which nothing reads any more (older exports, the bot's). */
  skipped: number;
}

export async function exportAliasesJson(db: OutboxDb): Promise<string> {
  const rows = await db.select().from(aliases).where(eq(aliases.kind, PAYEE));
  const exported: AliasExport[] = rows.map((row) => ({
    kind: row.kind, rawInput: row.rawInput, targetId: row.targetId, targetName: row.targetName,
  }));
  return JSON.stringify(exported, null, 2);
}

// Additive: an alias whose normalized key already exists is reported as a collision and left
// untouched, never silently overwritten — this is also how the bot's one-time Postgres export
// lands (brief §7 step 1), where the user's own edits since should win.
export async function importAliasesJson(db: OutboxDb, json: string): Promise<AliasImportResult> {
  const incoming: AliasExport[] = JSON.parse(json);
  const result: AliasImportResult = { imported: 0, collisions: [], skipped: 0 };

  for (const entry of incoming) {
    if (entry.kind !== PAYEE) {
      result.skipped += 1;
      continue;
    }
    const existing = await matchAlias(db, entry.kind, entry.rawInput);
    if (existing.matched) {
      result.collisions.push({
        kind: entry.kind, rawInput: entry.rawInput,
        existingTargetName: existing.alias.targetName, incomingTargetName: entry.targetName,
      });
      continue;
    }
    await upsertAlias(db, { kind: entry.kind, rawInput: entry.rawInput, targetId: entry.targetId, targetName: entry.targetName });
    result.imported += 1;
  }

  return result;
}
