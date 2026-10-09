// Helpers for transaction tags.
// Firefly III attaches tags directly to transaction splits.
// Internal app tags:
// - `mmyway-shared-<name>` (who a transaction was shared with, see src/transactions/sharedWith.ts)
// - `mmyway-reviewed` (review marker for recurring transactions, see src/sync/recurringReview.ts)
// - any other tag prefixed with `mmyway-`
// User tags are all other tags (e.g. `groceries`, `vacation`, `tax-2026`).
import { SHARED_TAG_PREFIX } from './sharedWith';

export const MMYWAY_TAG_PREFIX = 'mmyway-';

/** True when the tag is an actual user-facing tag, not an internal mmyway marker. */
export function isUserTag(tag: string): boolean {
  return !tag.startsWith(MMYWAY_TAG_PREFIX) && !tag.startsWith(SHARED_TAG_PREFIX);
}

/** Extracts only user tags from a tag list, preserving casing. */
export function userTags(tags: readonly string[]): string[] {
  return tags.filter(isUserTag);
}

/**
 * Splits a comma-separated or space-separated tag input string into clean, unique tag names.
 * Trims whitespace and strips empty entries.
 */
export function splitTags(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of text.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }
  return result;
}

/**
 * Replaces user tags in `tags` with `newUserTags`, preserving all internal `mmyway-` tags
 * (such as shared-with and recurring-review tags).
 */
export function withUserTags(tags: readonly string[], newUserTags: readonly string[]): string[] {
  const internal = tags.filter((t) => !isUserTag(t));
  const cleanedUserTags = splitTags(newUserTags.join(','));
  return [...internal, ...cleanedUserTags];
}

/** Parses tagsJson from SQLite cached_transactions, safe against corrupt JSON. */
export function parseTags(tagsJson: string | null | undefined): string[] {
  if (!tagsJson) return [];
  try {
    const parsed: unknown = JSON.parse(tagsJson);
    return Array.isArray(parsed)
      ? parsed.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}
