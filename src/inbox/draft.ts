import { eq, and, ne } from 'drizzle-orm';
import type { CreateTransactionPayload, OutboxDb } from '../sync/outbox';
import type { TransactionSplit } from '../api/ff3/types';
import { inboxItems } from '../db/schema';

export interface Draft {
  type: 'withdrawal' | 'deposit' | 'transfer';
  amount: string;
  currencyCode: string;
  foreignAmount?: string;
  foreignCurrencyCode?: string;
  date: string; // ISO 8601
  description: string;
  sourceName?: string;
  sourceId?: string;
  destinationName?: string;
  destinationId?: string;
  isNewPayee: boolean; // surfaced explicitly, never silently created (Global Constraints)
  categoryName?: string;
  budgetId?: string;
  notes?: string;
  sharedWith?: string; // -> `mmyway-shared-<person>` tag, brief §9 Q12
  extraTags?: string[]; // e.g. `mmyway-reconcile` (Task 9's cash count) — merged in ahead of sharedWith's tag
  // Field names the receipt provider couldn't confidently extract but still populated (design
  // §6.3): the draft screen marks these rows amber with "check this" instead of trusting them
  // silently. Never set outside src/receipt/toDraft.ts.
  lowConfidenceFields?: string[];
}

// Which end of the split is the free-text payee differs by type (defect (1)): a withdrawal's
// payee is the destination, a deposit's payee is the source, and a transfer has no payee at
// all — both ends are known asset accounts, so isNewPayee never gates them.
function payeeGatedEnd(draft: Draft): { source: { id?: string; name?: string }; destination: { id?: string; name?: string } } {
  if (draft.type === 'withdrawal') {
    return {
      source: { id: draft.sourceId, name: draft.sourceId ? undefined : draft.sourceName },
      destination: draft.isNewPayee
        ? { id: undefined, name: draft.destinationName }
        : { id: draft.destinationId, name: undefined },
    };
  }
  if (draft.type === 'deposit') {
    return {
      source: draft.isNewPayee
        ? { id: undefined, name: draft.sourceName }
        : { id: draft.sourceId, name: undefined },
      destination: { id: draft.destinationId, name: draft.destinationId ? undefined : draft.destinationName },
    };
  }
  // transfer: both ends are asset account ids, never a free-text name.
  return { source: { id: draft.sourceId, name: undefined }, destination: { id: draft.destinationId, name: undefined } };
}

export function draftToTransactionPayload(clientId: string, draft: Draft): CreateTransactionPayload {
  const tags: string[] = [...(draft.extraTags ?? [])];
  if (draft.sharedWith) tags.push(`mmyway-shared-${draft.sharedWith}`);
  const { source, destination } = payeeGatedEnd(draft);

  const split: TransactionSplit = {
    type: draft.type,
    date: draft.date,
    amount: draft.amount,
    currency_code: draft.currencyCode,
    foreign_amount: draft.foreignAmount,
    foreign_currency_code: draft.foreignCurrencyCode,
    description: draft.description,
    source_id: source.id,
    source_name: source.name,
    destination_id: destination.id,
    destination_name: destination.name,
    category_name: draft.categoryName,
    budget_id: draft.budgetId,
    tags: tags.length ? tags : undefined,
    notes: draft.notes,
  };

  return { clientId, splits: [split] };
}

export async function findDuplicateReceiptItem(db: OutboxDb, contentHash: string): Promise<{ id: string } | null> {
  const rows = await db.select().from(inboxItems).where(and(eq(inboxItems.receiptContentHash, contentHash), ne(inboxItems.state, 'error')));
  return rows[0] ? { id: rows[0].id } : null;
}
