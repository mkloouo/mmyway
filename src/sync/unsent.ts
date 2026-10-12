// Kept out of outbox.ts so the replay modules outbox.ts dispatches to can use it without an import
// cycle back into outbox.ts.
import { inArray } from 'drizzle-orm';
import { outboxOperations } from '../db/schema';

/**
 * An operation that hasn't gone out: replay may claim it and Cancel may drop it. `in_flight` is on
 * its way and left alone; `done` rows are deleted, not kept. Every "is it still queued?" question
 * asks through this (#79).
 */
const UNSENT_STATUSES = ['pending', 'failed'] as const;
export const isUnsent = () => inArray(outboxOperations.status, [...UNSENT_STATUSES]);
