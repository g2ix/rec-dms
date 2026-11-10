import "server-only";
import { authorize } from "@/server/authz";

/** Gate for the audit log and its CSV export. */
export async function assertCanViewAudit(userId: string): Promise<void> {
  await authorize({ id: userId }, "audit.view");
}
