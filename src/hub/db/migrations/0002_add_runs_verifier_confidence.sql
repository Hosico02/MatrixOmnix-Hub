ALTER TABLE `runs` ADD `verifier_catch_rate` real;
ALTER TABLE `runs` ADD `verifier_fp_rate` real;
ALTER TABLE `runs` ADD `verifier_pass_on_broken` integer;
ALTER TABLE `runs` ADD `verifier_criteria_met` integer;
ALTER TABLE `runs` ADD `verifier_model` text;
ALTER TABLE `runs` ADD `verifier_calibrated_at` text;
