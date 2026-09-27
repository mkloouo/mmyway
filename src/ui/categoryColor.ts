// A colour per category, derived from its name. Categories come from FF3 and are never
// hardcoded (AGENTS.md), so there is no table to maintain: the same name always lands on the
// same hue, and a category synced tomorrow gets a colour without a code change.
import { normkey } from '../lookup/normkey';

const HUES = [4, 28, 45, 88, 140, 165, 190, 212, 245, 275, 305, 335];

export function categoryColor(name: string, dark = false): string {
  const key = normkey(name);
  let hash = 5381;
  for (let i = 0; i < key.length; i += 1) hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0;
  const hue = HUES[hash % HUES.length] ?? HUES[0]!; // noUncheckedIndexedAccess: modulo is in range
  return dark ? `hsl(${hue}, 55%, 62%)` : `hsl(${hue}, 62%, 46%)`;
}
