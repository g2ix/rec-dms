import { config } from "dotenv";
import { existsSync } from "node:fs";

if (existsSync(".env")) config({ path: ".env" });
if (existsSync(".env.local")) config({ path: ".env.local", override: true });

const secret = process.env.CRON_SECRET ?? "";
const base = process.env.AUTH_URL || "http://localhost:3000";

if (!secret) {
  console.error("Set CRON_SECRET before running the dev cron. The routes refuse an empty secret.");
  process.exit(1);
}

async function tick() {
  for (const path of ["/api/cron/jobs", "/api/cron/sla"]) {
    const response = await fetch(new URL(path, base), {
      headers: { authorization: `Bearer ${secret}` },
    });
    const body = await response.text();
    console.log(`${new Date().toISOString()} ${path} ${response.status} ${body}`);
  }
}

await tick();
setInterval(() => {
  void tick();
}, 60_000);
console.log(`Calling ${base} every minute. Leave this running beside pnpm dev.`);
