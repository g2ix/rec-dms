-- M13: engine capabilities for the November 2026 process.

CREATE TYPE "FeeBasis" AS ENUM ('EXPEDITED', 'FULL', 'EXEMPT');
CREATE TYPE "BillStatus" AS ENUM ('ISSUED', 'PAID_PENDING', 'PARTIALLY_PAID', 'VERIFIED', 'REJECTED', 'WAIVED');

ALTER TABLE "user_roles" ADD COLUMN "attributes" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "protocols" ADD COLUMN "client_type_key" TEXT;
ALTER TABLE "protocols" ADD COLUMN "workflow_migration_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "protocol_versions" ADD COLUMN "reopen_baseline" JSONB;
ALTER TABLE "protocol_versions" ADD COLUMN "reopened_at" TIMESTAMP(3);
ALTER TABLE "protocol_versions" ADD COLUMN "reopen_forms" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "files" ADD COLUMN "bill_id" TEXT;
ALTER TABLE "files" ADD COLUMN "audience" TEXT;
ALTER TABLE "files" ADD COLUMN "variant" TEXT;
CREATE INDEX "files_bill_id_idx" ON "files"("bill_id");

ALTER TABLE "form_definitions" ADD COLUMN "effective_from" TIMESTAMP(3);
ALTER TABLE "form_definitions" ADD COLUMN "effective_announced_at" TIMESTAMP(3);

ALTER TABLE "workflow_versions" ADD COLUMN "effective_from" TIMESTAMP(3);
ALTER TABLE "workflow_versions" ADD COLUMN "effective_announced_at" TIMESTAMP(3);

ALTER TABLE "workflow_instances" ADD COLUMN "captures" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "tasks" ADD COLUMN "slot" TEXT;

CREATE TABLE "conflict_declarations" (
    "id" TEXT NOT NULL,
    "protocol_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "step_key" TEXT,
    "declared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "conflict_declarations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "conflict_declarations_protocol_id_user_id_idx" ON "conflict_declarations"("protocol_id", "user_id");

CREATE TABLE "setting_schedules" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "applied_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "setting_schedules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "setting_schedules_key_effective_from_idx" ON "setting_schedules"("key", "effective_from");

CREATE TABLE "code_counters" (
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "code_counters_pkey" PRIMARY KEY ("year")
);

CREATE TABLE "client_types" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "client_types_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "fee_schedules" (
    "id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "approved_ref" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fee_schedules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "fee_schedules_effective_from_idx" ON "fee_schedules"("effective_from");

CREATE TABLE "fee_rates" (
    "id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "client_type_key" TEXT NOT NULL,
    "basis" "FeeBasis" NOT NULL,
    "amount" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fee_rates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "fee_rates_schedule_id_client_type_key_basis_key" ON "fee_rates"("schedule_id", "client_type_key", "basis");
ALTER TABLE "fee_rates" ADD CONSTRAINT "fee_rates_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "fee_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "fee_rules" (
    "id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "percent" INTEGER NOT NULL,
    "from_round" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "fee_rules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "fee_rules_schedule_id_key_key" ON "fee_rules"("schedule_id", "key");
ALTER TABLE "fee_rules" ADD CONSTRAINT "fee_rules_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "fee_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "bills" (
    "id" TEXT NOT NULL,
    "protocol_id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "amount_paid" INTEGER NOT NULL DEFAULT 0,
    "schedule_id" TEXT,
    "client_type_key" TEXT,
    "basis" TEXT NOT NULL DEFAULT '',
    "status" "BillStatus" NOT NULL DEFAULT 'ISSUED',
    "reason" TEXT,
    "issued_by_id" TEXT,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_by_id" TEXT,
    "verified_at" TIMESTAMP(3),
    "statement_file_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "bills_protocol_id_round_idx" ON "bills"("protocol_id", "round");
CREATE INDEX "bills_status_idx" ON "bills"("status");
CREATE INDEX "bills_issued_at_idx" ON "bills"("issued_at");
ALTER TABLE "bills" ADD CONSTRAINT "bills_protocol_id_fkey" FOREIGN KEY ("protocol_id") REFERENCES "protocols"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bills" ADD CONSTRAINT "bills_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "fee_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- New tables need the recdms_app policy, as in the earlier migrations.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['conflict_declarations', 'setting_schedules', 'code_counters', 'client_types', 'fee_schedules', 'fee_rates', 'fee_rules', 'bills']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS recdms_app_all ON %I', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'recdms_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO recdms_app', t);
      EXECUTE format(
        'CREATE POLICY recdms_app_all ON %I FOR ALL TO recdms_app USING (true) WITH CHECK (true)',
        t
      );
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;
