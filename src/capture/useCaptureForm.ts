// Capture's form (design §6.2) as one reducer instead of fifteen separate useStates in the screen:
// every field lives in one object, and "clear after save" is a single action rather than a
// remembered list of setters.
import { useCallback, useMemo, useReducer } from 'react';
import type { Draft } from '../inbox/draft';

export type DateMode = 'today' | 'yesterday' | 'custom';

export interface CaptureForm {
  type: Draft['type'];
  amount: string;
  currencyCode: string | null;
  date: Date;
  dateMode: DateMode;
  merchantRawInput: string;
  forceNewPayee: boolean;
  sourceId: string | null;
  destinationId: string | null;
  categoryName: string | null;
  budgetId: string | null;
  description: string;
  notes: string;
  sharedWith: string;
  foreignAmount: string;
  photoUri: string | null; // a receipt photo, uploaded to FF3 once the transaction exists
}

type Action =
  | { kind: 'set'; field: keyof CaptureForm; value: unknown }
  | { kind: 'update'; field: keyof CaptureForm; updater: (current: never) => unknown }
  | { kind: 'saved' };

export function initialCaptureForm(now: Date = new Date()): CaptureForm {
  return {
    type: 'withdrawal', amount: '0', currencyCode: null, date: now, dateMode: 'today',
    merchantRawInput: '', forceNewPayee: false, sourceId: null, destinationId: null,
    categoryName: null, budgetId: null, description: '', notes: '', sharedWith: '', foreignAmount: '', photoUri: null,
  };
}

export function captureFormReducer(state: CaptureForm, action: Action): CaptureForm {
  switch (action.kind) {
    case 'set':
      return state[action.field] === action.value ? state : { ...state, [action.field]: action.value };
    case 'update':
      return { ...state, [action.field]: action.updater(state[action.field] as never) };
    case 'saved':
      // The screen stays open for the next entry (design §6.2): the amount clears, the rest of
      // the context (type, payee, accounts, date) is kept for a run of similar entries.
      return { ...state, amount: '0', foreignAmount: '', photoUri: null };
  }
}

type Setter<T> = (value: T | ((current: T) => T)) => void;
type Setters = { [K in keyof CaptureForm as `set${Capitalize<K & string>}`]: Setter<CaptureForm[K]> };

export function useCaptureForm(): CaptureForm & Setters & { markSaved: () => void } {
  const [form, dispatch] = useReducer(captureFormReducer, undefined, () => initialCaptureForm());
  const setters = useMemo(() => {
    const out: Record<string, Setter<unknown>> = {};
    for (const field of Object.keys(initialCaptureForm()) as (keyof CaptureForm)[]) {
      out[`set${field[0]!.toUpperCase()}${field.slice(1)}`] = (value) => dispatch(typeof value === 'function'
        ? { kind: 'update', field, updater: value as (current: never) => unknown }
        : { kind: 'set', field, value });
    }
    return out as unknown as Setters;
  }, []);
  const markSaved = useCallback(() => dispatch({ kind: 'saved' }), []);
  return { ...form, ...setters, markSaved };
}
