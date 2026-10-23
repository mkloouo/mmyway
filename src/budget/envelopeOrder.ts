// Custom display order for envelopes on the Budget tab.
// Stored in app_settings under 'envelope_order'.
import { useMemo } from 'react';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { appSettings } from '../db/schema';
import { useLiveQuery } from '../db/useLiveQuery';
import type { OutboxDb } from '../sync/outbox';
import type { Envelope } from '../bucket/envelopes';

export const ENVELOPE_ORDER_KEY = 'envelope_order';
const EnvelopeOrderSchema = z.record(z.string(), z.number());

export function parseEnvelopeOrder(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = EnvelopeOrderSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export function useEnvelopeOrder(db: OutboxDb): Record<string, number> {
  const { data: orderRows } = useLiveQuery(
    db.select().from(appSettings).where(eq(appSettings.key, ENVELOPE_ORDER_KEY)),
  );
  return useMemo(() => parseEnvelopeOrder(orderRows?.[0]?.value), [orderRows]);
}

export async function getEnvelopeOrder(db: OutboxDb): Promise<Record<string, number>> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, ENVELOPE_ORDER_KEY));
  return parseEnvelopeOrder(rows[0]?.value);
}

export async function setEnvelopeOrder(db: OutboxDb, order: Record<string, number>): Promise<void> {
  const value = JSON.stringify(order);
  await db
    .insert(appSettings)
    .values({ key: ENVELOPE_ORDER_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

export function sortEnvelopesByOrder(
  envelopes: Envelope[],
  order: Record<string, number>,
): Envelope[] {
  return [...envelopes].sort((a, b) => {
    const orderA = order[a.budgetId];
    const orderB = order[b.budgetId];
    if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
    if (orderA !== undefined) return -1;
    if (orderB !== undefined) return 1;
    return a.name.localeCompare(b.name);
  });
}
