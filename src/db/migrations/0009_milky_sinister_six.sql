CREATE TABLE `planned_objects` (
	`key` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`ff3_id` text NOT NULL,
	`name` text NOT NULL,
	`attributes_json` text NOT NULL,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `cached_transactions` ADD `splits_json` text;