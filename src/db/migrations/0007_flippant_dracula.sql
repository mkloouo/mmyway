ALTER TABLE `cached_transactions` ADD `source_id` text;--> statement-breakpoint
ALTER TABLE `cached_transactions` ADD `destination_id` text;--> statement-breakpoint
ALTER TABLE `cached_transactions` ADD `budget_id` text;--> statement-breakpoint
ALTER TABLE `cached_transactions` ADD `split_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `cached_transactions` ADD `search_key` text;