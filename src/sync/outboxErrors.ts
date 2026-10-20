import { FF3RequestError } from '../api/ff3/client';
import type { TransactionRead } from '../api/ff3/types';

/** The idempotency key sent with every create; part of FF3's duplicate hash, unlike group_title. */
export function internalReferenceFor(clientId: string): string {
  return `mmyway:${clientId}`;
}

export function duplicateOf(err: unknown): string | null {
  if (!(err instanceof FF3RequestError) || err.status !== 422) return null;
  return /Duplicate of transaction #(\d+)/.exec(err.body)?.[1] ?? null;
}

export function splitReference(group: TransactionRead | undefined): string | null {
  const split = group?.attributes.transactions[0] as
    { internal_reference?: string | null } | undefined;
  return split?.internal_reference ?? null;
}

/**
 * A failure that isn't about this operation: FF3 didn't answer, is failing itself, refuses the
 * token, or is rate limiting. Anything else (a 4xx about this request, a conflict, bad data) is
 * the operation's own.
 */
export function serverUnavailable(err: unknown): boolean {
  if (err instanceof FF3RequestError) {
    return err.status >= 500 || err.status === 401 || err.status === 403 || err.status === 429;
  }
  // fetch rejects with a TypeError when there was no answer, and an AbortError on a timeout.
  return err instanceof TypeError || (err instanceof Error && err.name === 'AbortError');
}

/**
 * What the Inbox's failed-operation card shows: FF3's own message and first field error instead of
 * the raw JSON body (`401: {"message":"Unauthenticated.","exception":…}`).
 *
 * @public Exported for outbox.regressions.test.ts, which loads it with `requireActual`.
 */
export function describeFF3Error(err: FF3RequestError): string {
  // Which call, and which fields FF3 named: a planned save makes three calls, and "The notes must
  // be at least 1 characters" alone didn't say which of them refused it.
  const where = (fields: string[]) =>
    err.request ? ` — ${err.request}${fields.length ? ` (${fields.join(', ')})` : ''}` : '';
  try {
    const body: { message?: string; errors?: Record<string, string[]> } = JSON.parse(err.body);
    const field = body.errors ? Object.values(body.errors).flat()[0] : undefined;
    const text = [body.message, field]
      .filter((part, i, all) => !!part && all.indexOf(part) === i)
      .join(' — ');
    if (text) return `${text} (${err.status})${where(Object.keys(body.errors ?? {}))}`;
  } catch {
    // not JSON: an HTML error page or empty body
  }
  return err.body && err.body.length < 200 && !err.body.trimStart().startsWith('<')
    ? `${err.body} (${err.status})${where([])}`
    : `Firefly III answered ${err.status}${where([])}`;
}

export const describeFf3Error = describeFF3Error;
