import { MembersPanel } from "@/components/protocols/members-panel";
import { suggestAffiliation } from "@/server/protocols/affiliation";
import { roster } from "@/server/protocols/read";
import { requireUser } from "@/server/session";

export default async function ProtocolMembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const [{ members, mine }, suggestions] = await Promise.all([roster(user.id, id), suggestAffiliation(user.id)]);
  const rows = members.map((member) => ({
    id: member.id,
    name: member.user?.displayName ?? member.invitedEmail ?? "Invited person",
    email: member.contactEmail?.email ?? member.invitedEmail ?? "",
    role: member.role,
    status: member.status,
    designation: member.designation,
    isLeader: member.isLeader,
    rosterOrder: member.rosterOrder,
  }));
  const invite = mine?.status === "INVITED" ? rows.find((row) => row.id === mine.id) ?? null : null;
  return (
    <MembersPanel
      protocolId={id}
      members={rows}
      canManage={Boolean(mine?.isLeader && mine.status === "ACTIVE" && mine.role === "PROPONENT")}
      invite={invite}
      emails={suggestions.emails}
    />
  );
}
