-- Which role view a notification is for. NULL (older notices) shows in every role.
ALTER TABLE "notifications" ADD COLUMN "role_view" TEXT;

CREATE INDEX "notifications_user_id_role_view_read_at_idx" ON "notifications"("user_id", "role_view", "read_at");
