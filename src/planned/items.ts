// What the Planned tab's simple view lists: FF3's objects grouped by name, with the saves and
// deletes still waiting in the queue already applied, so an edit made offline shows at once.
// Pure, no db.
import { byDate, fieldsOf, groupPlanned, type PlannedFields, type PlannedGroup } from './model';
import type { PlannedObject } from './objects';
import type { DeletePlannedPayload, SavePlannedPayload } from './replay';
import { tryReadPayload } from '../sync/payloadJson';

export interface PlannedItem {
  key: string;
  fields: PlannedFields;
  group: PlannedGroup | null; // null: created here, not in FF3 yet
  queued: boolean;
}

interface OutboxRow {
  kind: string;
  sequence: number;
  payloadJson: string;
}

function matches(
  group: PlannedGroup,
  p: { key: string; billId?: string | null; ruleId?: string | null; recurrenceId?: string | null },
): boolean {
  return (
    group.key === p.key ||
    (!!p.billId && group.bill?.id === p.billId) ||
    (!!p.ruleId && group.rule?.id === p.ruleId) ||
    (!!p.recurrenceId && group.recurrence?.id === p.recurrenceId)
  );
}

export function plannedItems(
  objects: readonly PlannedObject[],
  outbox: readonly OutboxRow[],
  today: string,
): PlannedItem[] {
  const groups = groupPlanned(objects);
  const items: PlannedItem[] = groups.map((group) => ({
    key: group.key,
    fields: fieldsOf(group, today),
    group,
    queued: false,
  }));
  const ops = [...outbox]
    .filter((op) => op.kind === 'save_planned' || op.kind === 'delete_planned')
    .sort((a, b) => a.sequence - b.sequence);
  let list = items;
  for (const op of ops) {
    const payload = tryReadPayload<SavePlannedPayload | DeletePlannedPayload>(
      op.kind,
      op.payloadJson,
    );
    if (!payload) continue;
    const index = list.findIndex((item) =>
      item.group ? matches(item.group, payload) : item.key === payload.key,
    );
    if (op.kind === 'delete_planned') {
      if (index >= 0) list = list.filter((_, i) => i !== index);
      continue;
    }
    const save = payload as SavePlannedPayload;
    if (index >= 0)
      list = list.map((item, i) =>
        i === index ? { ...item, fields: save.fields, queued: true } : item,
      );
    else list = [...list, { key: save.key, fields: save.fields, group: null, queued: true }];
  }
  // A planned transaction is the whole trio. A subscription, rule or recurring transaction on its
  // own (or a pair) is only in the detailed view — unless a save here is on its way to complete it.
  return list.filter((item) => item.queued || !item.group || isComplete(item.group)).sort(byDate);
}

function isComplete(group: PlannedGroup): boolean {
  return !!group.bill && !!group.rule && !!group.recurrence;
}
