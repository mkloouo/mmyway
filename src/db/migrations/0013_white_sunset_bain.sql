CREATE TABLE `payee_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`alias` text NOT NULL,
	`normalized_alias` text NOT NULL,
	`payee_name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payee_aliases_payee_idx` ON `payee_aliases` (`payee_name`);--> statement-breakpoint
CREATE INDEX `payee_aliases_norm_idx` ON `payee_aliases` (`normalized_alias`);