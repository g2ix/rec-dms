import "server-only";
import { assertBootstrapAdmin } from "@/server/auth/bootstrap";

/**
 * Gate for the audit log and its CSV export.
 * M02 replaces this with authorize(user, "audit.view").
 */
export async function assertCanViewAudit(userId: string): Promise<void> {
  await assertBootstrapAdmin(userId);
}
