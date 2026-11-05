import Link from "next/link";
import { redirect } from "next/navigation";
import { StatusBadge } from "@/components/ui/status-badge";
import { authorize } from "@/server/authz";
import { requireUser } from "@/server/session";
import { createWorkflowAction, draftFromPublishedAction } from "@/server/workflow/actions";
import { listWorkflows } from "@/server/workflow/definitions";

export const metadata = { title: "Workflows" };

const STATUS = {
  DRAFT: { tone: "draft", label: "Draft" },
  PUBLISHED: { tone: "success", label: "Published" },
  ARCHIVED: { tone: "info", label: "Archived" },
} as const;

export default async function WorkflowsPage() {
  const user = await requireUser();
  try {
    await authorize(user, "workflow.view");
  } catch {
    redirect("/app");
  }
  const definitions = await listWorkflows();
  return (
    <article className="rec-stack">
      <h1 className="title">Workflows</h1>
      <p className="body rec-muted">
        A submission runs the published version. Protocols already in review stay on the version they started with.
      </p>
      <form action={createWorkflowAction} className="rec-stack">
        <div className="rec-actions">
          <label className="rec-field">
            <span className="label">Key</span>
            <input className="rec-input" name="key" required placeholder="INITIAL_SUBMISSION" />
          </label>
          <label className="rec-field">
            <span className="label">Name</span>
            <input className="rec-input" name="name" required />
          </label>
          <label className="rec-field">
            <span className="label">Submission type</span>
            <input className="rec-input" name="submissionType" required placeholder="Initial" />
          </label>
        </div>
        <button className="rec-btn rec-btn--primary" type="submit">
          <span>New workflow</span>
        </button>
      </form>
      {definitions.length === 0 ? (
        <p className="body">No workflows yet.</p>
      ) : (
        definitions.map((definition) => (
          <section key={definition.id} className="rec-card rec-stack">
            <h2 className="heading">{definition.name}</h2>
            <p className="code">{definition.key}</p>
            <p className="body-sm rec-muted">{definition.submissionType}</p>
            <div className="rec-table-wrap">
              <table className="rec-table">
                <thead>
                  <tr>
                    <th scope="col">Version</th>
                    <th scope="col">Status</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {definition.versions.map((version) => {
                    const status = STATUS[version.status];
                    return (
                      <tr key={version.id}>
                        <td className="code">{version.number}</td>
                        <td>
                          <StatusBadge tone={status.tone} label={status.label} />
                        </td>
                        <td>
                          <Link href={`/admin/workflows/${version.id}`}>Open</Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {definition.versions.some((version) => version.status === "PUBLISHED") &&
            !definition.versions.some((version) => version.status === "DRAFT") ? (
              <form action={draftFromPublishedAction}>
                <input type="hidden" name="definitionId" value={definition.id} />
                <button className="rec-btn rec-btn--secondary" type="submit">
                  <span>New draft from published</span>
                </button>
              </form>
            ) : null}
          </section>
        ))
      )}
    </article>
  );
}
