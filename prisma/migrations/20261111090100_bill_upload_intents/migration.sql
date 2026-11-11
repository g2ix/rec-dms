-- Proof of payment can be uploaded against a bill while the version is frozen.
ALTER TABLE "upload_intents" ADD COLUMN "bill_id" TEXT;
