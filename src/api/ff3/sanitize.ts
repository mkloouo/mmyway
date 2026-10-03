// Preprocessing for Firefly III API payloads. What FF3 actually validates, probed against
// fireflyiii/core:version-6.7.6 (the version `npm run ff3:test` pins) rather than assumed:
// - tags: `/v1/recurrences` rejects `[]` with "transactions.0.tags must be at least 1 characters";
//   it accepts `[""]`. `/v1/transactions` accepts `[]` on both POST and PUT, and a PUT with `[]`
//   is how tags get cleared (see editSplits.ts). So omitting an empty array is for recurrences.
// - notes: `/v1/transactions` accepts `""` and stores it as null, so sending null is what FF3
//   does anyway, not a workaround for a rejection.
// - coordinates: a half pair (latitude without longitude) is accepted, and zoom_level is
//   optional. Dropping an incomplete pair keeps a stray half-coordinate off the FF3 map.
// - description: `""` and null both fail "The description field is required." Trimming one to
//   null changes the shape, not the outcome.
// - text fields: trimmed, because the account name is what resolution matches on.
/** Sanitizes notes: empty string or whitespace becomes null (clears in FF3). */
export function sanitizeNotes(notes: string | null | undefined): string | null | undefined {
  if (notes === undefined) return undefined;
  if (notes === null || notes.trim().length === 0) return null;
  return notes;
}

/** Sanitizes tags: strips empty/whitespace strings. If empty, returns undefined so JSON.stringify omits the key. */
export function sanitizeTags(
  tags: (string | null | undefined)[] | null | undefined,
): string[] | undefined {
  if (!tags || !Array.isArray(tags)) return undefined;
  const cleaned = tags
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter((t) => t.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Sanitizes location coordinates so incomplete pairs are omitted, avoiding required_with validation errors. */
export function sanitizeLocation(loc?: {
  latitude?: number | null;
  longitude?: number | null;
  zoom_level?: number | null;
}): { latitude?: number; longitude?: number; zoom_level?: number } {
  if (loc?.latitude == null || loc?.longitude == null) return {};
  return {
    latitude: loc.latitude,
    longitude: loc.longitude,
    zoom_level: loc.zoom_level ?? 16,
  };
}

/** Sanitizes a single transaction split before sending to FF3. */
export function sanitizeSplit<T extends Record<string, unknown>>(split: T): T {
  const out = { ...split } as Record<string, unknown>;

  if ('notes' in out) {
    const cleanedNotes = sanitizeNotes(out.notes as string | null | undefined);
    if (cleanedNotes === undefined) delete out.notes;
    else out.notes = cleanedNotes;
  }

  if ('tags' in out) {
    const cleanedTags = sanitizeTags(out.tags as string[] | null | undefined);
    if (cleanedTags === undefined) delete out.tags;
    else out.tags = cleanedTags;
  }

  if ('latitude' in out || 'longitude' in out || 'zoom_level' in out) {
    const loc = sanitizeLocation({
      latitude: out.latitude as number | null | undefined,
      longitude: out.longitude as number | null | undefined,
      zoom_level: out.zoom_level as number | null | undefined,
    });
    delete out.latitude;
    delete out.longitude;
    delete out.zoom_level;
    Object.assign(out, loc);
  }

  for (const key of ['description', 'category_name', 'source_name', 'destination_name']) {
    if (typeof out[key] === 'string') {
      const trimmed = (out[key] as string).trim();
      out[key] = trimmed.length > 0 ? trimmed : null;
    }
  }

  return out as T;
}
