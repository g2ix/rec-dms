-- CreateEnum
CREATE TYPE "NotificationEmailStatus" AS ENUM ('NONE', 'QUEUED', 'SENT', 'FAILED', 'DIGEST');

-- CreateEnum
CREATE TYPE "DigestMode" AS ENUM ('IMMEDIATE', 'DAILY');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "title" TEXT NOT NULL DEFAULT '',
ADD COLUMN "body" TEXT NOT NULL DEFAULT '',
ADD COLUMN "link" TEXT,
ADD COLUMN "protocol_id" TEXT,
ADD COLUMN "task_id" TEXT,
ADD COLUMN "email_status" "NotificationEmailStatus" NOT NULL DEFAULT 'NONE';

ALTER TABLE "notifications" ALTER COLUMN "payload" SET DEFAULT '{}';

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body_markdown" TEXT NOT NULL,
    "channels" TEXT[] DEFAULT ARRAY['IN_APP', 'EMAIL']::TEXT[],
    "description" TEXT NOT NULL DEFAULT '',
    "variables" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" TEXT NOT NULL,
    "digest" "DigestMode" NOT NULL DEFAULT 'IMMEDIATE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_email_status_idx" ON "notifications"("email_status");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_key_key" ON "notification_templates"("key");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_protocol_id_fkey" FOREIGN KEY ("protocol_id") REFERENCES "protocols"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
