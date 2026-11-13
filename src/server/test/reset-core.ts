import type { PrismaClient } from "@prisma/client";
import { TEST_SCHEMA, isTestDatabase } from "@/server/test/test-database";

type SchemaRow = { current: string | null; db: string };

function schemaFromDatabaseUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).searchParams.get("schema");
  } catch {
    return null;
  }
}

/**
 * Truncates every application table in the current schema of `client`, after checking the
 * database Postgres reports: only a database named *_test or the schema recdms_test (never the
 * Supabase `recdms` schema or a shared `public`). Shared by the vitest reset and the Playwright setup.
 */
export async function resetTestDatabase(client: PrismaClient): Promise<void> {
  if (schemaFromDatabaseUrl(process.env.DATABASE_URL) === TEST_SCHEMA) {
    await client.$executeRawUnsafe(`SET search_path TO "${TEST_SCHEMA}"`);
  }

  const rows = await client.$queryRaw<SchemaRow[]>`
    select current_schema() as current, current_database() as db
  `;
  const current = rows[0]?.current ?? "";
  const db = rows[0]?.db ?? "";
  if (!isTestDatabase(db, current)) {
    throw new Error(`Refusing to reset database "${db}" schema "${current}". Use a database named *_test or the schema ${TEST_SCHEMA}.`);
  }

  await client.$executeRawUnsafe(`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = current_schema()
          AND tablename <> '_prisma_migrations'
      LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(current_schema()) || '.' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
      END LOOP;
    END $$;
  `);
}
