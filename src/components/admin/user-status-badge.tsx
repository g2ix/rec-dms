import type { UserStatus } from "@prisma/client";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";

const STATUS: Record<UserStatus, { tone: StatusTone; label: string }> = {
  ACTIVE: { tone: "success", label: "Active" },
  PENDING_APPROVAL: { tone: "info", label: "Pending approval" },
  SUSPENDED: { tone: "danger", label: "Suspended" },
  MERGED: { tone: "draft", label: "Merged" },
};

export function UserStatusBadge({ status }: { status: UserStatus }) {
  return <StatusBadge {...STATUS[status]} />;
}
