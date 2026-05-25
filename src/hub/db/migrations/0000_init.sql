CREATE TABLE `d2p_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`payload_hash` text NOT NULL,
	`received_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`instance_id`) REFERENCES `d2p_instances`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_time` ON `events` (`received_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `events_dedup` ON `events` (`instance_id`,`event_type`,`payload_hash`);--> statement-breakpoint
CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`verdict_id` text NOT NULL,
	`category` text NOT NULL,
	`severity` text NOT NULL,
	`message` text,
	`evidence` text,
	`is_new` integer NOT NULL,
	FOREIGN KEY (`verdict_id`) REFERENCES `verdicts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `findings_cat_sev` ON `findings` (`category`,`severity`);--> statement-breakpoint
CREATE INDEX `findings_by_verdict` ON `findings` (`verdict_id`);--> statement-breakpoint
CREATE TABLE `iterations` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`iter_n` integer NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`analyzer_summary` text,
	`planner_summary` text,
	`executor_summary` text,
	`qa_summary` text,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `iter_by_run` ON `iterations` (`run_id`,`iter_n`);--> statement-breakpoint
CREATE TABLE `mentor_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`author` text NOT NULL,
	`body_md` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `proposal_evidence` (
	`proposal_id` text NOT NULL,
	`finding_id` text NOT NULL,
	PRIMARY KEY(`proposal_id`, `finding_id`),
	FOREIGN KEY (`proposal_id`) REFERENCES `proposals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`finding_id`) REFERENCES `findings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`archetype` text NOT NULL,
	`proposal_type` text NOT NULL,
	`body_md` text NOT NULL,
	`rationale_md` text NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`decided_at` text,
	`decided_by` text,
	`resulting_standard_version_id` text,
	FOREIGN KEY (`resulting_standard_version_id`) REFERENCES `standard_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `proposals_status_arche` ON `proposals` (`status`,`archetype`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`project_path` text NOT NULL,
	`detected_archetype` text,
	`started_at` text NOT NULL,
	`terminated_at` text,
	`terminal_state` text,
	`total_cost_usd` real DEFAULT 0,
	`total_iterations` integer DEFAULT 0,
	FOREIGN KEY (`instance_id`) REFERENCES `d2p_instances`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `runs_instance_time` ON `runs` (`instance_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `runs_archetype_state` ON `runs` (`detected_archetype`,`terminal_state`);--> statement-breakpoint
CREATE TABLE `standard_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`standards_id` text NOT NULL,
	`version` integer NOT NULL,
	`body_md` text NOT NULL,
	`diff_from_prev_md` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`standards_id`) REFERENCES `standards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `standards` (
	`id` text PRIMARY KEY NOT NULL,
	`archetype` text NOT NULL,
	`version` integer NOT NULL,
	`body_md` text NOT NULL,
	`is_current` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`approved_by` text,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `standards_arche_current` ON `standards` (`archetype`,`is_current`);--> statement-breakpoint
CREATE TABLE `verdicts` (
	`id` text PRIMARY KEY NOT NULL,
	`iteration_id` text NOT NULL,
	`verdict` text NOT NULL,
	`confidence` real,
	`stability_signal` text,
	`suggested_next_focus` text,
	`raw_response` text,
	`standards_version_id` text,
	FOREIGN KEY (`iteration_id`) REFERENCES `iterations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`standards_version_id`) REFERENCES `standard_versions`(`id`) ON UPDATE no action ON DELETE no action
);
