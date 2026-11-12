import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const IDENTITY_FILES = new Set(["src/server/auth/actions.ts", "src/server/auth/totp-actions.ts"]);

const SELF_FUNCTIONS = new Set([
  "presenceAction",
  "markNotificationRead",
  "markAllNotificationsRead",
  "markReadAction",
  "markAllReadAction",
  "saveNotificationPreference",
  "saveSignatureAction",
  "saveProfileAction",
  "sendSigningCodeAction",
  "acceptInviteAction",
]);

const PUBLIC_ROUTES = new Set([
  "src/app/api/health/route.ts",
  "src/app/api/auth/[...nextauth]/route.ts",
]);

const SELF_ROUTES = new Set([
  "src/app/api/notifications/route.ts",
  "src/app/api/account/export/route.ts",
  "src/app/app/reports/export/route.ts",
  "src/app/api/session/end/route.ts",
]);

const GATES = [
  "authorize(",
  "adminUser(",
  "authorizeInstance(",
  "authorizeFormInstance(",
  "saveNotificationTemplate(",
  "assertCanViewAudit(",
  "cronAuthorized(",
];

export type SurfaceGap = { file: string; name: string; reason: string };

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(path, out);
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(path);
  }
  return out;
}

function functionsIn(source: string): { name: string; body: string }[] {
  const matches = [...source.matchAll(/export async function (\w+)/g)];
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? source.length;
    return { name: match[1] ?? "", body: source.slice(start, end) };
  });
}

function hasGate(body: string): boolean {
  return GATES.some((gate) => body.includes(gate));
}

export function findAuthzGaps(root = process.cwd()): SurfaceGap[] {
  const gaps: SurfaceGap[] = [];
  for (const file of walk(join(root, "src"))) {
    const rel = relative(root, file).replaceAll("\\", "/");
    const source = readFileSync(file, "utf8");
    if (source.includes('"use server"') || source.includes("'use server'")) {
      if (IDENTITY_FILES.has(rel)) continue;
      for (const fn of functionsIn(source)) {
        if (SELF_FUNCTIONS.has(fn.name)) continue;
        if (!hasGate(fn.body)) {
          gaps.push({ file: rel, name: fn.name, reason: "server action does not call authorize" });
        }
      }
    }
    if (!rel.endsWith("/route.ts")) continue;
    if (PUBLIC_ROUTES.has(rel)) continue;
    if (rel.includes("/api/auth/")) continue;
    const handlers = functionsIn(source);
    if (handlers.length === 0 && !source.includes("export const { GET, POST }")) {
      gaps.push({ file: rel, name: "(route)", reason: "route has no handler" });
      continue;
    }
    if (SELF_ROUTES.has(rel)) {
      if (!source.includes("requireUser(")) {
        gaps.push({ file: rel, name: "(route)", reason: "self route does not call requireUser" });
      }
      continue;
    }
    for (const fn of handlers) {
      const delegated = /return GET\(/.test(fn.body) && source.includes("cronAuthorized(");
      if (hasGate(fn.body) || delegated) continue;
      gaps.push({ file: rel, name: fn.name, reason: "route does not call authorize or cronAuthorized" });
    }
  }
  return gaps;
}
