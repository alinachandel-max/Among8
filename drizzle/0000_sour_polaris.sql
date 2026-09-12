CREATE TABLE `rate_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`hits` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_limits_expires_at_idx` ON `rate_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`host_hash` text NOT NULL,
	`host_name` text NOT NULL,
	`host_avatar` text NOT NULL,
	`host_seen_at` integer NOT NULL,
	`guest_hash` text,
	`guest_name` text,
	`guest_avatar` text,
	`guest_seen_at` integer DEFAULT 0 NOT NULL,
	`phase` text DEFAULT 'waiting' NOT NULL,
	`round` integer DEFAULT 0 NOT NULL,
	`start_at` integer DEFAULT 0 NOT NULL,
	`deadline` integer DEFAULT 0 NOT NULL,
	`reveal_at` integer DEFAULT 0 NOT NULL,
	`host_answer` integer,
	`guest_answer` integer,
	`host_ready` integer DEFAULT 0 NOT NULL,
	`guest_ready` integer DEFAULT 0 NOT NULL,
	`host_score` integer DEFAULT 0 NOT NULL,
	`guest_score` integer DEFAULT 0 NOT NULL,
	`history` text DEFAULT '[]' NOT NULL,
	`question_ids` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_host_hash_unique` ON `rooms` (`host_hash`);--> statement-breakpoint
CREATE INDEX `rooms_expires_at_idx` ON `rooms` (`expires_at`);