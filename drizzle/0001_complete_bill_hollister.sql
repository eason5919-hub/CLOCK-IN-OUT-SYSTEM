CREATE UNIQUE INDEX `idx_attendance_employee_date` ON `attendance` (`employee_id`,`work_date`);--> statement-breakpoint
CREATE INDEX `idx_attendance_work_date` ON `attendance` (`work_date`);--> statement-breakpoint
CREATE INDEX `idx_corrections_status` ON `attendance_corrections` (`status`);--> statement-breakpoint
CREATE INDEX `idx_audit_entity` ON `audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_devices_employee_id` ON `devices` (`employee_id`);