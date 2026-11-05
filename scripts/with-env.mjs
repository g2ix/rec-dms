import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { config } from "dotenv";

if (existsSync(".env")) config({ path: ".env" });
if (existsSync(".env.local")) config({ path: ".env.local", override: true });

const result = spawnSync("pnpm", ["exec", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
  shell: true,
});

process.exit(result.status ?? 1);
