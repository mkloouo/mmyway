// Preprocessing and payload sanitization for Firefly III API requests.
// Firefly III has strict validation rules:
// - tags: validated with `min:1`, rejecting `[]` or `[""]`. Must be omitted if empty.
// - notes: rejects `""` of length 0 with "at least 1 characters". Must be `null` to clear.
// - coordinates: latitude, longitude, zoom_level must travel together (required_with).
// - text fields: should be trimmed.

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
