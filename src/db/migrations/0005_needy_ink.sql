ALTER TABLE `reference_accounts` ADD `account_role` text;--> statement-breakpoint
ALTER TABLE `reference_accounts` ADD `include_net_worth` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `reference_accounts` ADD `opening_balance` text;--> statement-breakpoint
ALTER TABLE `reference_accounts` ADD `opening_balance_date` text;--> statement-breakpoint
ALTER TABLE `reference_accounts` ADD `virtual_balance` text;--> statement-breakpoint
ALTER TABLE `reference_accounts` ADD `credit_card_type` text;--> statement-breakpoint
ALTER TABLE `reference_accounts` ADD `monthly_payment_date` text;