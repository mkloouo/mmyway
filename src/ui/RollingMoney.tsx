// Money that rolls to its new value instead of jumping: an account balance changing after a sync
// counts up or down over a moment. Every frame is exact decimal arithmetic in minor units
// (src/splits/allocate.ts) — the easing picks a fraction in permille, never a float amount.
import { useEffect, useRef, useState } from 'react';
import { Money } from './components';
import type { DisplayCurrency } from './money';
import { fromMinor, toMinor } from '../splits/allocate';

const DURATION_MS = 700;

const easeOut = (p: number) => 1 - (1 - p) ** 3;

export function RollingMoney({ amount, currency, type, size }: {
  amount: string;
  currency: DisplayCurrency;
  type?: 'withdrawal' | 'deposit' | 'transfer';
  size?: 'body' | 'heading' | 'title' | 'display';
}) {
  const [shown, setShown] = useState(amount);
  // What is on screen right now, so a change mid-roll starts from there rather than jumping.
  const onScreen = useRef(amount);

  useEffect(() => {
    const dp = currency.decimalPlaces;
    const from = toMinor(onScreen.current, dp);
    const to = toMinor(amount, dp);
    if (from === to) {
      onScreen.current = amount;
      return;
    }
    let frame = 0;
    const started = Date.now();
    const step = () => {
      const p = Math.min(1, (Date.now() - started) / DURATION_MS);
      const next = p >= 1 ? amount : fromMinor(from + ((to - from) * BigInt(Math.round(easeOut(p) * 1000))) / 1000n, dp);
      onScreen.current = next;
      setShown(next);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [amount, currency.decimalPlaces]);

  return <Money amount={shown} currency={currency} type={type} size={size} />;
}
