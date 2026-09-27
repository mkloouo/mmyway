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
}

export function draftToTransactionPayload(clientId: string, draft: Draft): CreateTransactionPayload {
  const tags: string[] = [];
  if (draft.sharedWith) tags.push(`mmyway-shared-${draft.sharedWith}`);

  const split: TransactionSplit = {
    type: draft.type,
    date: draft.date,
    amount: draft.amount,
    currency_code: draft.currencyCode,
    foreign_amount: draft.foreignAmount,
    foreign_currency_code: draft.foreignCurrencyCode,
    description: draft.description,
    source_id: draft.sourceId,
    source_name: draft.sourceId ? undefined : draft.sourceName,
    // Only send destination_name when the payee is explicitly new (Global Constraints /
    // brief §3.4 bug fix); an existing payee must go through destination_id.
    destination_id: draft.isNewPayee ? undefined : draft.destinationId,
    destination_name: draft.isNewPayee ? draft.destinationName : undefined,
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
