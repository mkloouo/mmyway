import { captureFormReducer, initialCaptureForm } from './useCaptureForm';

describe('captureFormReducer', () => {
  const start = initialCaptureForm(new Date(2026, 8, 28));

  it('sets a field, keeping the same object when nothing changed', () => {
    const next = captureFormReducer(start, { kind: 'set', field: 'merchantRawInput', value: 'Żabka' });
    expect(next.merchantRawInput).toBe('Żabka');
    expect(captureFormReducer(next, { kind: 'set', field: 'merchantRawInput', value: 'Żabka' })).toBe(next);
  });

  it('applies an updater to the current value', () => {
    const next = captureFormReducer({ ...start, amount: '1' }, { kind: 'update', field: 'amount', updater: ((a: string) => `${a}2`) as never });
    expect(next.amount).toBe('12');
  });

  it('after a save clears the amount, conversion and photo but keeps the context', () => {
    const filled = { ...start, amount: '12', foreignAmount: '3', photoUri: 'file:///p.jpg', merchantRawInput: 'Żabka', categoryName: 'Food' };
    expect(captureFormReducer(filled, { kind: 'saved' })).toMatchObject({ amount: '0', foreignAmount: '', photoUri: null, merchantRawInput: 'Żabka', categoryName: 'Food' });
  });
});
