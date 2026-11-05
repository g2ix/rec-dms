import { prisma } from "@/server/db";

type SchemaRow = {
  current: string | null;
  db: string;
};

function schemaFromDatabaseUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).searchParams.get("schema");
  } catch {
    return null;
  }
}

/**
 * Truncates every application table in the current schema.
 * Refuses `public` on a database that is not a dedicated test database,
 * so a shared Supabase project cannot be wiped by the test runner.
 */
export async function resetDatabase(): Promise<void> {
  const wanted = schemaFromDatabaseUrl(process.env.DATABASE_URL);
  if (wanted === "recdms" || wanted === "recdms_test") {
    await prisma.$executeRawUnsafe(`SET search_path TO "${wanted}"`);
  }

  const rows = await prisma.$queryRaw<SchemaRow[]>`
    select current_schema() as current, current_database() as db
  `;
  const current = rows[0]?.current ?? "";
  const db = rows[0]?.db ?? "";
  const allowed =
    current === "recdms" ||
    current === "recdms_test" ||
    db.endsWith("_test");

  if (!allowed) {
    throw new Error(
      `Refusing to reset database "${db}" schema "${current}". Use a database named *_test or the schema recdms / recdms_test.`,
    );
  }

  await prisma.$executeRawUnsafe(`
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
