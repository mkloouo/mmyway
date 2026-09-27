export interface ReceiptExtraction {
  amount: string | null; // decimal string
  currency: string | null; // ISO code, validated by the caller against synced currencies
  merchant: string | null;
  date: string | null; // YYYY-MM-DD
  time: string | null; // HH:mm
  category: string | null;
  items: { title: string; count: number; price: string }[];
  confidence: number; // 0..1
  paymentMethod: 'cash' | 'card' | 'unknown';
  cardNetwork: string | null;
}

export interface ReceiptProvider {
  name: string;
  extract(input: { imageBase64: string; hint?: string; categoryNames: string[] }): Promise<ReceiptExtraction>;
}

export type ReceiptChainResult = {
  ok: true;
  providerName: string;
  extraction: ReceiptExtraction;
} | {
  ok: false;
  // unreachable: nothing answered (offline, PC asleep, timeout) — worth retrying on a later sync.
  // failed: at least one provider answered but gave nothing usable — retrying the same image
  // won't help, so the receipt is shown as an error instead of "Reading receipt…" forever.
  reason: 'all_providers_unreachable' | 'all_providers_failed';
  errors: string[]; // one line per provider, for the error card and the log
};
