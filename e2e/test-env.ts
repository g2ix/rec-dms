import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { testDatabaseRefusal } from "../src/server/test/test-database";

/**
 * The end-to-end tests run only on the test environment: `.env.test`, never `.env.local` (which
 * points at the development Supabase database). Loading also refuses any database that is not a
 * test one, so Playwright stops before it starts a server or writes a row.
 */
export const E2E_PORT = 3100;
export const E2E_ORIGIN = `http://localhost:${E2E_PORT}`;

const root = path.resolve(__dirname, "..");

export function testEnv(): Record<string, string> {
  const file = path.join(root, ".env.test");
  if (!existsSync(file)) throw new Error("End-to-end tests need .env.test (copy .env.test.example).");
  const env: Record<string, string> = { ...parse(readFileSync(file)), AUTH_URL: E2E_ORIGIN };
  const refusal = testDatabaseRefusal(env.DATABASE_URL);
  if (refusal) throw new Error(`Refusing to run end-to-end tests: .env.test ${refusal}`);
  return env;
}

/** Puts the test environment in process.env, over anything the shell set (a stray DATABASE_URL included). */
export function loadTestEnv(): Record<string, string> {
  const env = testEnv();
  Object.assign(process.env, env);
  return env;
}

/**
 * The web server's environment. Next.js reads `.env.local` on its own and keeps any variable
 * already set, so every key `.env.local` has and `.env.test` lacks is set empty here.
 */
export function serverEnv(): Record<string, string> {
  const env = testEnv();
  const local = path.join(root, ".env.local");
  const blanks = existsSync(local) ? Object.fromEntries(Object.keys(parse(readFileSync(local))).filter((key) => !(key in env)).map((key) => [key, ""])) : {};
  return { ...blanks, ...env, PORT: String(E2E_PORT), NEXT_DIST_DIR: ".next-e2e" };
}
