import { config } from "dotenv";
import { execSync } from "node:child_process";

export default function globalSetup(): void {
  config({ path: ".env.test" });
  if (!process.env.DATABASE_URL) return;

  execSync("pnpm exec prisma migrate deploy", {
    stdio: "inherit",
    env: process.env,
  });
}
