CREATE TABLE `bucket_objects` (
	`key` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`ff3_id` text NOT NULL,
	`period_start` text,
	`attributes_json` text NOT NULL,
	`synced_at` text NOT NULL
);
