import { redirect } from "next/navigation";
import Link from "next/link";
import { WorkflowEditor } from "@/components/workflow/workflow-editor";
import { parseGraph } from "@/lib/workflow/graph";
import { authorize } from "@/server/authz";
import { requireUser } from "@/server/session";
import { getWorkflowVersion } from "@/server/workflow/definitions";
import { publishedFormCodes } from "@/server/workflow/engine";
import { listHolidays, holidayDay } from "@/server/workflow/holidays";

export const metadata = { title: "Workflow" };

export default async function WorkflowVersionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; published?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const user = await requireUser();
  try {
    await authorize(user, "workflow.view");
  } catch {
    redirect("/app");
  }
  const version = await getWorkflowVersion(id);
  const parsed = parseGraph(version.graph);
  const graph = parsed.ok
    ? parsed.graph
    : {
        startStep: "start",
        steps: [{ key: "start", name: "Start", type: "TASK" as const, assignee: { kind: "PROTOCOL_LEADER" as const } }],
        transitions: [],
      };
  const [codes, holidays] = await Promise.all([publishedFormCodes(), listHolidays()]);
  return (
    <article className="rec-stack">
      <p className="body-sm">
        <Link href="/admin/workflows">Workflows</Link>
      </p>
      <h1 className="title">{version.definition.name}</h1>
      <p className="body rec-muted">
        <span className="code">{version.definition.key}</span> · version <span className="code">{version.number}</span> · {version.status}
      </p>
      {query.error ? (
        <p className="rec-alert" role="alert">
          {query.error}
        </p>
      ) : null}
      {query.published ? <p className="body-sm">Published. New submissions use this version.</p> : null}
      {!parsed.ok ? <p className="body-sm">{parsed.message}</p> : null}
      <WorkflowEditor
        versionId={version.id}
        draft={version.status === "DRAFT"}
        initial={graph}
        publishedCodes={[...codes]}
        holidays={holidays.map((holiday) => holidayDay(holiday.date))}
      />
    </article>
  );
}
