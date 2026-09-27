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
  reason: 'all_providers_failed' | 'all_providers_unreachable';
};
