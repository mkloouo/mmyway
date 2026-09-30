// Capture's form (design §6.2) as one reducer instead of fifteen separate useStates in the screen:
// every field lives in one object, and "clear after save" is a single action rather than a
// remembered list of setters.
import { useCallback, useReducer } from 'react';
import type { Draft } from '../inbox/draft';
import { applyDigit, type KeypadKey } from './amountInput';

type DateMode = 'today' | 'yesterday' | 'custom';

interface CaptureForm {
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
  | { kind: 'set'; patch: Partial<CaptureForm> }
  | { kind: 'key'; key: KeypadKey; decimalPlaces: number }
  | { kind: 'saved' };

export function initialCaptureForm(now: Date = new Date()): CaptureForm {
  return {
    type: 'withdrawal',
    amount: '0',
    currencyCode: null,
    date: now,
    dateMode: 'today',
    merchantRawInput: '',
    forceNewPayee: false,
    sourceId: null,
    destinationId: null,
    categoryName: null,
    budgetId: null,
    description: '',
    notes: '',
    sharedWith: '',
    foreignAmount: '',
    photoUri: null,
  };
}

export function captureFormReducer(state: CaptureForm, action: Action): CaptureForm {
  switch (action.kind) {
    case 'set': {
      const entries = Object.entries(action.patch) as [keyof CaptureForm, unknown][];
      // Same object when nothing actually changed, so the screen doesn't re-render for a no-op.
      return entries.every(([field, value]) => state[field] === value)
        ? state
        : { ...state, ...action.patch };
    }
    case 'key':
      // Applied to the amount as it is now, not as the last render saw it: two quick taps that
      // land before a re-render used to both start from the same amount, and the first was lost.
      return { ...state, amount: applyDigit(state.amount, action.key, action.decimalPlaces) };
    case 'saved':
      // The screen stays open for the next entry (design §6.2): the amount clears, the rest of
      // the context (type, payee, accounts, date) is kept for a run of similar entries.
      // In 'today' mode, the date is refreshed so the next entry starts with the current time.
      return {
        ...state,
        amount: '0',
        foreignAmount: '',
        photoUri: null,
        date: state.dateMode === 'today' ? new Date() : state.date,
      };
  }
}

export function useCaptureForm(): CaptureForm & {
  set: (patch: Partial<CaptureForm>) => void;
  pressKey: (key: KeypadKey, decimalPlaces: number) => void;
  markSaved: () => void;
} {
  const [form, dispatch] = useReducer(captureFormReducer, undefined, () => initialCaptureForm());
  const set = useCallback((patch: Partial<CaptureForm>) => dispatch({ kind: 'set', patch }), []);
  const pressKey = useCallback(
    (key: KeypadKey, decimalPlaces: number) => dispatch({ kind: 'key', key, decimalPlaces }),
    [],
  );
  const markSaved = useCallback(() => dispatch({ kind: 'saved' }), []);
  return { ...form, set, pressKey, markSaved };
}
