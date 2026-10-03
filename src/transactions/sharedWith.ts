// Who a transaction is shared with: one Firefly III tag per person, `mmyway-shared-<name>`. On
// screen it is one text field with the names separated by commas. Pure.

export const SHARED_TAG_PREFIX = 'mmyway-shared-';

/** "Anna, Bob,, anna " → ["Anna", "Bob"]: trimmed, blanks dropped, each name once. */
export function sharedNames(text: string | null | undefined): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of (text ?? '').split(',')) {
    const name = part.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  return names;
}

/** One tag per name in `text`. */
export function sharedTags(text: string | null | undefined): string[] {
  return sharedNames(text).map((name) => `${SHARED_TAG_PREFIX}${name}`);
}

/** The people named by a transaction's tags. */
export function sharedNamesFromTags(tags: readonly string[]): string[] {
  return tags
    .filter((tag) => tag.startsWith(SHARED_TAG_PREFIX))
    .map((tag) => tag.slice(SHARED_TAG_PREFIX.length))
    .filter((name) => name.length > 0);
}

/** Every shared-with tag's name, as the field shows them ("Anna, Bob"); null when there is none. */
export function sharedWithFromTags(tags: readonly string[]): string | null {
  const names = sharedNamesFromTags(tags);
  return names.length > 0 ? names.join(', ') : null;
}

/** `text` with `name` added if it isn't there and taken out if it is — what a suggestion chip does. */
export function toggleSharedName(text: string | null | undefined, name: string): string {
  const names = sharedNames(text);
  const without = names.filter((n) => n.toLowerCase() !== name.trim().toLowerCase());
  return (without.length === names.length ? [...names, name.trim()] : without).join(', ');
}

/** `tags` with its shared-with tags replaced by the names in `text`; every other tag is kept. */
export function withSharedWith(tags: readonly string[], text: string | null): string[] {
  return [...tags.filter((tag) => !tag.startsWith(SHARED_TAG_PREFIX)), ...sharedTags(text)];
}
