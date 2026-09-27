CREATE TABLE `aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`normalized_key` text NOT NULL,
	`raw_input` text NOT NULL,
	`target_id` text,
	`target_name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cached_transactions` (
	`group_id` text PRIMARY KEY NOT NULL,
	`journal_id` text NOT NULL,
	`type` text NOT NULL,
	`date` text NOT NULL,
	`amount` text NOT NULL,
	`currency_code` text NOT NULL,
	`foreign_amount` text,
	`foreign_currency_code` text,
	`description` text NOT NULL,
	`source_name` text,
	`destination_name` text,
	`category_name` text,
	`budget_name` text,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`notes` text,
	`updated_at` text NOT NULL,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inbox_items` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`draft_json` text NOT NULL,
	`receipt_image_path` text,
	`receipt_content_hash` text,
	`ff3_group_id` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `outbox_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`inbox_item_id` text,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`sequence` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reference_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`currency_code` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reference_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reference_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reference_currencies` (
	`code` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`decimal_places` integer NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reference_tags` (
	`tag` text PRIMARY KEY NOT NULL,
	`synced_at` text NOT NULL
);
