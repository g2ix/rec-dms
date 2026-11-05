import { AuditTimeline } from "@/components/audit/audit-timeline";
import { ProtocolFlow } from "@/components/workflow/protocol-flow";
import { BusyButton } from "@/components/ui/busy-button";
import { roster } from "@/server/protocols/read";
import { protocolFlow } from "@/server/workflow/read";
import { startRevisionAction, submitVersionAction } from "@/server/protocols/actions";
import { protocolHeader } from "@/server/protocols/read";
import { requireUser } from "@/server/session";

export default async function ProtocolOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const user = await requireUser();
  const [header, people, flow] = await Promise.all([protocolHeader(user.id, id), roster(user.id, id), protocolFlow(id, user.id)]);
  const leader = header.mine?.isLeader && header.mine.role === "PROPONENT" && header.mine.status === "ACTIVE";
  const workflowRunning = flow?.instance.status === "RUNNING";
  return (
    <div className="rec-stack">
      {error ? (
        <p className="rec-alert" role="alert">
          {error}
        </p>
      ) : null}
      <section className="rec-card rec-stack">
        <h2 className="heading">Roster</h2>
        <ul className="rec-methods">
          {people.members.map((member) => (
            <li key={member.id}>
              <p className="body">
                {member.user?.displayName ?? member.invitedEmail ?? "Invited"}
                {member.isLeader ? " · Project leader" : ""}
                {member.role === "ADVISER" ? " · Adviser" : ""}
                {member.status === "INVITED" ? " · Invited" : ""}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <ProtocolFlow protocolId={id} userId={user.id} />
      {leader && header.working && !workflowRunning ? (
        <form action={submitVersionAction}>
          <input type="hidden" name="protocolId" value={id} />
          <BusyButton type="submit" variant="primary">
            Submit version
          </BusyButton>
        </form>
      ) : null}
      {leader && !header.working ? (
        <form action={startRevisionAction}>
          <input type="hidden" name="protocolId" value={id} />
          <BusyButton type="submit">{header.protocol.versions.length === 0 ? "Start the working version" : "Start a revision"}</BusyButton>
        </form>
      ) : null}
      {!leader ? <p className="body-sm rec-muted">Only the project leader can submit a version.</p> : null}
      <section className="rec-stack">
        <h2 className="heading">Activity</h2>
        <AuditTimeline protocolId={id} simplified />
      </section>
    </div>
  );
}
