import { AuditTimeline } from "@/components/audit/audit-timeline";
import { requireUser } from "@/server/session";

export default async function ProtocolActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  return (
    <section className="rec-stack">
      <h2 className="heading">Activity</h2>
      <AuditTimeline protocolId={id} viewerUserId={user.id} simplified />
    </section>
  );
}
