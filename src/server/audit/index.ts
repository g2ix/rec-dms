import "server-only";
import { prisma } from "@/server/db";
import { recordAuditEvent, verifyAuditChain, type ChainRange } from "@/server/audit/chain";

export { AUDIT_GENESIS, canonicalJson, hashAudit } from "@/server/audit/hash";
export { AUDIT_REDACTED, diffOf } from "@/server/audit/diff";
export type { AuditInput, ChainRange, ChainVerification } from "@/server/audit/chain";
export { auditRequestMeta } from "@/server/audit/context";
export { recordAudit } from "@/server/audit/write";

export const audit = {
  record: recordAuditEvent,
  verifyChain(range?: ChainRange) {
    return verifyAuditChain(prisma, range);
  },
};
