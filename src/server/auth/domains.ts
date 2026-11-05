import "server-only";
import { z } from "zod";
import { DEFAULT_AUTO_APPROVE_DOMAINS } from "@/lib/approval";
import { prisma } from "@/server/db";

const domainsSchema = z.array(z.string().min(1));

export async function autoApproveDomains(): Promise<string[]> {
  const row = await prisma.setting.findUnique({ where: { key: "auth.autoApproveDomains" } });
  const parsed = domainsSchema.safeParse(row?.value);
  if (!parsed.success || parsed.data.length === 0) return [...DEFAULT_AUTO_APPROVE_DOMAINS];
  return parsed.data;
}
