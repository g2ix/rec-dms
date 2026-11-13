/**
 * The one rule for a database the tests may wipe: a database whose name ends in `_test`, or the
 * schema `recdms_test`. Anything else, the Supabase `recdms` schema included, is refused.
 * Pure (no Prisma), so the Playwright config can check before it starts a server.
 */
export const TEST_SCHEMA = "recdms_test";

export function isTestDatabase(database: string, schema: string | null | undefined): boolean {
  return database.endsWith("_test") || schema === TEST_SCHEMA;
}

/** Null when `url` names a test database; otherwise why it is refused (never the URL itself, which holds the password). */
export function testDatabaseRefusal(url: string | undefined): string | null {
  if (!url) return "DATABASE_URL is not set.";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "DATABASE_URL is not a valid URL.";
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const schema = parsed.searchParams.get("schema");
  if (isTestDatabase(database, schema)) return null;
  return `database "${database}" schema "${schema ?? "public"}" on ${parsed.hostname} is not a test database. Use a database named *_test or the schema ${TEST_SCHEMA}.`;
}
