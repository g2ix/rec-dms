import { ProtocolList } from "@/components/protocols/protocol-list";
import { listForRole } from "@/server/protocols/read";
import { requireUser } from "@/server/session";

export const metadata = { title: "My protocols" };

export default async function MyProtocolsPage() {
  const user = await requireUser();
  const rows = await listForRole(user.id, "PROPONENT");
  return (
    <article className="rec-stack">
      <h1 className="title">My protocols</h1>
      <p className="body rec-muted">Protocols where you are a proponent.</p>
      <ProtocolList rows={rows} empty="You have no protocols yet. Start one from New protocol." />
    </article>
  );
}
