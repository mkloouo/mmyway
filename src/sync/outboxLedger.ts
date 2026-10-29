import { LEDGER_KINDS, type OutboxRow, type UpdateAccountPayload } from './outboxTypes';
import { tryReadPayload } from './payloadJson';

/** Whether a queued operation can invalidate the balances used by Count cash. */
export function affectsBalances(op: Pick<OutboxRow, 'kind' | 'payloadJson'>): boolean {
  if (op.kind !== 'update_account') {
    return (LEDGER_KINDS as readonly string[]).includes(op.kind);
  }
  const payload = tryReadPayload<UpdateAccountPayload>(op.kind, op.payloadJson);
  // An unreadable operation must be resolved before the count can trust its balances.
  if (!payload) return true;
  return ['openingBalance', 'openingBalanceDate', 'virtualBalance', 'currencyCode'].some((key) =>
    Object.hasOwn(payload.edit ?? {}, key),
  );
}
