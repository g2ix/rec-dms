import { describe, expect, it } from "vitest";
import { isTestDatabase, testDatabaseRefusal } from "@/server/test/test-database";

describe("the test database rule", () => {
  it("allows a *_test database or the recdms_test schema", () => {
    expect(isTestDatabase("recdms_test", "public")).toBe(true);
    expect(isTestDatabase("postgres", "recdms_test")).toBe(true);
    expect(testDatabaseRefusal("postgresql://u:p@127.0.0.1:5432/recdms_test")).toBeNull();
    expect(testDatabaseRefusal("postgresql://u:p@db.example.supabase.co:6543/postgres?schema=recdms_test")).toBeNull();
  });

  it("refuses the Supabase recdms schema and a plain public schema, without printing the password", () => {
    const supabase = testDatabaseRefusal("postgresql://u:secret@db.example.supabase.co:6543/postgres?schema=recdms");
    expect(supabase).toContain('schema "recdms"');
    expect(supabase).not.toContain("secret");
    expect(testDatabaseRefusal("postgresql://u:p@127.0.0.1:5432/recdms")).toContain('schema "public"');
    expect(testDatabaseRefusal(undefined)).toBe("DATABASE_URL is not set.");
  });
});
