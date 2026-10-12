import type { OutboxDb } from '../sync/outbox';
import { getPayeesWithAliases, rememberPayeeAlias } from './aliases';

type AliasExportFormat = Record<string, string[]>;

/** Exports all payee aliases grouped by canonical payee as formatted JSON. */
export async function exportAliasesJson(db: OutboxDb): Promise<string> {
  const groups = await getPayeesWithAliases(db);
  const result: AliasExportFormat = {};
  for (const group of groups) {
    result[group.payeeName] = group.aliases.map((a) => a.alias);
  }
  return JSON.stringify(result, null, 2);
}

/** Imports payee aliases from JSON in { [canonicalPayee: string]: string[] } format. */
export async function importAliasesJson(
  db: OutboxDb,
  jsonString: string,
): Promise<{ importedCount: number }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new Error('Invalid JSON format');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object mapping payee names to lists of aliases');
  }

  let count = 0;
  for (const [payeeName, rawAliases] of Object.entries(parsed as Record<string, unknown>)) {
    if (!payeeName.trim() || !Array.isArray(rawAliases)) continue;
    for (const alias of rawAliases) {
      if (typeof alias === 'string' && alias.trim()) {
        const learned = await rememberPayeeAlias(db, alias.trim(), payeeName.trim());
        if (learned) count++;
      }
    }
  }

  return { importedCount: count };
}
