import { ProtocolList } from "@/components/protocols/protocol-list";
import { listForRole } from "@/server/protocols/read";
import { requireUser } from "@/server/session";

export const metadata = { title: "Advised protocols" };

export default async function AdvisedPage() {
  const user = await requireUser();
  const rows = await listForRole(user.id, "ADVISER");
  return (
    <article className="rec-stack">
      <h1 className="title">Advised protocols</h1>
      <ProtocolList rows={rows} empty="You are not advising a protocol yet." />
    </article>
  );
}
