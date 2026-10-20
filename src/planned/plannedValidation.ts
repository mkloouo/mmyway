// Pure validation and change detection for Planned transactions.
import {
  momentFor,
  repetitionProblem,
  sameEnd,
  sameRepetitions,
  type EndCondition,
  type Repetition,
  type RepetitionType,
} from './repetition';
import type { PlannedFields } from './model';

/**
 * A `save_planned` queued by a build that kept five presets and `repetitions[0]`: it sits in the
 * outbox across an app update, so it is read back rather than failed. One pure function instead of
 * a payload version bump and a v1→v2 converter, which is strictly more code for the same result.
 */
export function normalizeFields(fields: PlannedFields): PlannedFields {
  if (Array.isArray(fields.repetitions) && fields.repetitions.length > 0) return fields;
  const legacy = fields as unknown as { frequency?: string; every?: number };
  const every = Math.max(1, legacy.every ?? 1);
  // The five presets, back to what they meant: quarterly and half-year were monthly + skip.
  const scaled: Record<string, { type: RepetitionType; every: number }> = {
    daily: { type: 'daily', every },
    weekly: { type: 'weekly', every },
    monthly: { type: 'monthly', every },
    quarterly: { type: 'monthly', every: every * 3 },
    'half-year': { type: 'monthly', every: every * 6 },
    yearly: { type: 'yearly', every },
  };
  const { type, every: n } = scaled[legacy.frequency ?? 'monthly'] ?? scaled.monthly!;
  return {
    ...fields,
    repetitions: [{ type, moment: momentFor(type, fields.date), skip: n - 1, weekend: 1 }],
    end: fields.end ?? (fields.repeats ? { kind: 'forever' } : { kind: 'times', count: 1 }),
    skipDays: fields.skipDays ?? [],
  };
}

/** Whether a change touches the schedule; unchanged, the objects' own dates are left alone. */
export function scheduleChanged(before: PlannedFields | null, after: PlannedFields): boolean {
  return (
    !before ||
    before.date !== after.date ||
    before.repeats !== after.repeats ||
    !sameEnd(before.end, after.end) ||
    !sameRepetitions(before.repetitions, after.repetitions)
  );
}

/** Whether `after` says what `before` does: Save on a planned transaction left as it was queues nothing. */
export function samePlannedFields(before: PlannedFields, after: PlannedFields): boolean {
  return (Object.keys(before) as (keyof PlannedFields)[]).every((key) => {
    const [a, b] = [before[key], after[key]];
    if (key === 'repetitions') return sameRepetitions(a as Repetition[], b as Repetition[]);
    if (key === 'end') return sameEnd(a as EndCondition, b as EndCondition);
    if (Array.isArray(a) && Array.isArray(b)) return a.join('\n') === b.join('\n');
    // A notes field typed into and emptied again is '' where FF3's was null.
    if (key === 'notes') return (a || null) === (b || null);
    return a === b;
  });
}

/** Next occurrence first; undated last. */
export function byDate(a: { fields: PlannedFields }, b: { fields: PlannedFields }): number {
  return a.fields.date.localeCompare(b.fields.date) || a.fields.name.localeCompare(b.fields.name);
}

/** The fields every save must have; the rest are optional. */
export function plannedProblems(f: PlannedFields): string[] {
  const problems: string[] = [];
  if (!f.name.trim()) problems.push('name');
  if (/^0*\.?0*$/.test(f.amount)) problems.push('amount');
  if (!f.currencyCode) problems.push('currency');
  // Every type needs both ends: an own account and a payee/payer, or two own accounts.
  if (!f.sourceId && !f.sourceName) problems.push('source');
  if (!f.destinationId && !f.destinationName) problems.push('destination');
  if (f.repeats) {
    if (f.repetitions.length === 0 || f.repetitions.some(repetitionProblem))
      problems.push('schedule');
    if (f.end.kind === 'until' && f.end.date < f.date) problems.push('endDate');
  }
  return problems;
}
