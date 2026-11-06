-- Dashboard and report filters over a full committee caseload.
CREATE INDEX "protocols_panel_id_status_review_type_idx" ON "protocols"("panel_id", "status", "review_type");

CREATE INDEX "protocol_members_user_id_role_status_idx" ON "protocol_members"("user_id", "role", "status");

CREATE INDEX "protocol_versions_submitted_at_idx" ON "protocol_versions"("submitted_at");

CREATE INDEX "notifications_protocol_id_created_at_idx" ON "notifications"("protocol_id", "created_at");

CREATE INDEX "tasks_assignee_user_id_status_idx" ON "tasks"("assignee_user_id", "status");

CREATE INDEX "tasks_step_key_status_created_at_idx" ON "tasks"("step_key", "status", "created_at");

CREATE INDEX "workflow_instances_status_idx" ON "workflow_instances"("status");

CREATE INDEX "workflow_instances_current_step_keys_idx" ON "workflow_instances" USING GIN ("current_step_keys");

CREATE INDEX "audit_events_protocol_id_occurred_at_idx" ON "audit_events"("protocol_id", "occurred_at");
