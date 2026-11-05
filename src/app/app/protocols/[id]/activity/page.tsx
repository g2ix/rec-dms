import { AuditTimeline } from "@/components/audit/audit-timeline";

export default async function ProtocolActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <section className="rec-stack">
      <h2 className="heading">Activity</h2>
      <AuditTimeline protocolId={id} simplified />
    </section>
  );
}
