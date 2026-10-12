// Ready to Assign — the one number the Budget tab exists for (plan §1):
//
//   Liquid cash     = Σ active asset accounts' current_balance
//   Allocated       = Σ max(0, envelope available) + Σ piggy current_amount + Σ unpaid bills due
//   Ready to Assign = Liquid cash − Allocated
//
// Every sum is done in the currency's minor units as a BigInt (src/splits/allocate.ts), never a
// float. `max(0, …)` is the one subtlety: an overspent envelope has already taken the overspend out
// of the account balance, so counting its negative remainder again would inflate RTA by it twice.
import { fromMinor, sumMinor, toMinor } from '../splits/allocate';

interface RtaInput {
  /** Active asset accounts' balances, as FF3 cached them. */
  cash: readonly string[];
  /** Each envelope's `available` — may be negative; the negatives are dropped here. */
  envelopeAvailable: readonly string[];
  fundsSaved: readonly string[];
  /** Bills due in the open period that FF3 has not seen paid yet. */
  billsDue: readonly string[];
  decimalPlaces: number;
}

export interface Rta {
  cash: string;
  envelopes: string;
  funds: string;
  bills: string;
  allocated: string;
  /** Negative when more is allocated than is actually in the accounts. */
  readyToAssign: string;
}

export function readyToAssign(input: RtaInput): Rta {
  const dp = input.decimalPlaces;
  const cash = sumMinor(input.cash, dp);
  const envelopes = input.envelopeAvailable.reduce((total, amount) => {
    const minor = toMinor(amount, dp);
    return minor > 0n ? total + minor : total;
  }, 0n);
  const funds = sumMinor(input.fundsSaved, dp);
  const bills = sumMinor(input.billsDue, dp);
  const allocated = envelopes + funds + bills;
  return {
    cash: fromMinor(cash, dp),
    envelopes: fromMinor(envelopes, dp),
    funds: fromMinor(funds, dp),
    bills: fromMinor(bills, dp),
    allocated: fromMinor(allocated, dp),
    readyToAssign: fromMinor(cash - allocated, dp),
  };
}
