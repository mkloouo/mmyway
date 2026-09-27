export interface SystemInfo {
  data: { version: string; api_version: string };
}

export interface CurrencyRead {
  id: string;
  attributes: { code: string; symbol: string; decimal_places: number };
}

export interface AccountRead {
  id: string;
  attributes: { name: string; type: string; currency_code: string; active: boolean };
}

export interface CategoryRead {
  id: string;
  attributes: { name: string };
}

export interface BudgetRead {
  id: string;
  attributes: { name: string; active: boolean };
}

export interface TransactionSplit {
  transaction_journal_id?: string;
  type: 'withdrawal' | 'deposit' | 'transfer';
  date: string;
  amount: string;
  currency_code?: string;
  foreign_amount?: string;
  foreign_currency_code?: string;
  description: string;
  source_id?: string;
  source_name?: string;
  destination_id?: string;
  destination_name?: string;
  category_name?: string;
  budget_id?: string;
  tags?: string[];
  notes?: string;
}

export interface TransactionRead {
  id: string;
  attributes: { transactions: (TransactionSplit & { transaction_journal_id: string; updated_at: string })[] };
}

export interface AttachmentRead {
  id: string;
  attributes: {
    filename: string;
    attachable_type: string;
    attachable_id: string;
    upload_url?: string;
    download_url?: string;
    size?: number;
  };
}

export type AuthErrorReason =
  | 'invalid_host'
  | 'invalid_api_key'
  | 'unexpected_status'
  | 'not_a_firefly_instance'
  | 'api_version_too_low';
