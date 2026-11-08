import Link from "next/link";
import { ProtocolList } from "@/components/protocols/protocol-list";
import { isReturnedStatus } from "@/lib/dashboard/proponent";
import { listForRole } from "@/server/protocols/read";
import { requireUser } from "@/server/session";

export const metadata = { title: "My protocols" };

export default async function MyProtocolsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const user = await requireUser();
  const all = await listForRole(user.id, "PROPONENT");
  const returned = status === "returned";
  const rows = returned ? all.filter((row) => isReturnedStatus(row.status)) : all;
  return (
    <article className="rec-stack">
      <h1 className="title">My protocols</h1>
      {returned ? (
        <p className="body rec-muted">
          Returned protocols.{" "}
          <Link className="rec-link" href="/app/protocols">
            Show all protocols
          </Link>
        </p>
      ) : (
        <p className="body rec-muted">Protocols where you are a proponent.</p>
      )}
      <ProtocolList
        rows={rows}
        empty={returned ? "No protocol has been returned to you." : "You have no protocols yet. Start one from New protocol."}
      />
    </article>
  );
}
