import Link from "next/link";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { FormProgress } from "@/lib/protocols/format";
import { listWorkingForms, protocolHeader } from "@/server/protocols/read";
import { requireUser } from "@/server/session";

const TONE: Record<FormProgress, StatusTone> = {
  "Not started": "draft",
  "In progress": "info",
  Complete: "success",
  "Needs signatures": "warning",
};

export default async function ProtocolFormsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const [header, forms] = await Promise.all([protocolHeader(user.id, id), listWorkingForms(user.id, id)]);
  if (!header.working) {
    return <p className="body">This version is submitted. Start a revision to edit forms.</p>;
  }
  if (forms.length === 0) {
    return (
      <p className="body">
        No forms are required yet. REC Staff sets <span className="code">protocol.requiredForms</span> until the workflow chooses them.
      </p>
    );
  }
  return (
    <ul className="rec-methods">
      {forms.map((form) => (
        <li key={form.instanceId}>
          <Link href={`/app/protocols/${id}/forms/${form.instanceId}`} className="rec-card rec-proto-card">
            <div className="rec-inline">
              <span className="code">{form.code}</span>
              <StatusBadge tone={TONE[form.progress]} label={form.progress} />
            </div>
            <h2 className="heading">{form.title}</h2>
          </Link>
        </li>
      ))}
    </ul>
  );
}
