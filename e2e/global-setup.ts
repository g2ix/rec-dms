import { config } from "dotenv";
import { execSync } from "node:child_process";

export default function globalSetup(): void {
  config({ path: ".env.local" });
  config({ path: ".env" });
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for end-to-end tests.");
  }
  execSync("pnpm exec prisma migrate deploy", { stdio: "inherit", env: process.env });
}
