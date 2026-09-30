import { captureFormReducer, initialCaptureForm } from './useCaptureForm';

describe('captureFormReducer', () => {
  const start = initialCaptureForm(new Date(2026, 8, 28));

  it('applies a patch, keeping the same object when nothing changed', () => {
    const next = captureFormReducer(start, { kind: 'set', patch: { merchantRawInput: 'Żabka' } });
    expect(next.merchantRawInput).toBe('Żabka');
    expect(captureFormReducer(next, { kind: 'set', patch: { merchantRawInput: 'Żabka' } })).toBe(
      next,
    );
  });

  it('sets several fields at once', () => {
    const next = captureFormReducer(start, {
      kind: 'set',
      patch: { dateMode: 'yesterday', sourceId: 'a1' },
    });
    expect(next.dateMode).toBe('yesterday');
    expect(next.sourceId).toBe('a1');
  });

  it('after a save clears the amount, conversion and photo but keeps the context and refreshes date in today mode', () => {
    const filled = {
      ...start,
      amount: '12',
      foreignAmount: '3',
      photoUri: 'file:///p.jpg',
      merchantRawInput: 'Żabka',
      categoryName: 'Food',
      dateMode: 'today' as const,
      date: new Date(2026, 8, 28, 10, 0),
    };
    const saved = captureFormReducer(filled, { kind: 'saved' });
    expect(saved).toMatchObject({
      amount: '0',
      foreignAmount: '',
      photoUri: null,
      merchantRawInput: 'Żabka',
      categoryName: 'Food',
    });
    expect(saved.date.getTime()).toBeGreaterThan(filled.date.getTime());

    const yesterdayFilled = { ...filled, dateMode: 'yesterday' as const };
    const savedYesterday = captureFormReducer(yesterdayFilled, { kind: 'saved' });
    expect(savedYesterday.date).toBe(yesterdayFilled.date);
  });
});

describe('captureFormReducer keypad', () => {
  it('applies each key to the amount as it is by then, so quick taps all land', () => {
    const start = initialCaptureForm(new Date(2026, 8, 28));
    const keys = ['1', '2', ',', '5', '⌫'] as const;
    const end = keys.reduce(
      (s, key) => captureFormReducer(s, { kind: 'key', key, decimalPlaces: 2 }),
      start,
    );
    expect(end.amount).toBe('12.');
  });
});
