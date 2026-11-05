import Link from "next/link";
import { cookies } from "next/headers";
import { StatusBadge } from "@/components/ui/status-badge";
import { knownRoleView } from "@/lib/role-view";
import { formatManila } from "@/lib/time";
import { requireUser } from "@/server/session";
import { inboxFor } from "@/server/workflow/read";

export const metadata = { title: "My tasks" };

const DUE = {
  overdue: { tone: "danger", label: "Overdue" },
  soon: { tone: "warning", label: "Due soon" },
  scheduled: null,
  none: null,
} as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  const { scope } = await searchParams;
  const user = await requireUser();
  const jar = await cookies();
  const view = scope === "all" ? "all" : (knownRoleView(jar.get("activeView")?.value) ?? "proponent");
  const tasks = await inboxFor(user.id, view);
  return (
    <article className="rec-stack">
      <h1 className="title">My tasks</h1>
      <p className="body rec-muted">
        {view === "all" ? "Every open task assigned to you." : "Open tasks for the role you are viewing as."}{" "}
        {view === "all" ? <Link href="/app/tasks">This role</Link> : <Link href="/app/tasks?scope=all">All my tasks</Link>}
      </p>
      {tasks.length === 0 ? (
        <p className="body">Nothing is waiting on you.</p>
      ) : (
        <div className="rec-table-wrap">
          <table className="rec-table">
            <thead>
              <tr>
                <th scope="col">Task</th>
                <th scope="col">Protocol</th>
                <th scope="col">Due</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => {
                const due = DUE[task.due];
                return (
                  <tr key={task.id}>
                    <td>
                      <Link href={task.href}>{task.title}</Link>
                      {!task.claimed ? <p className="caption">Unclaimed</p> : null}
                    </td>
                    <td>
                      <p className="body-sm">{task.protocolTitle}</p>
                      <p className="code">{task.protocolCode ?? "Code not assigned"}</p>
                    </td>
                    <td>
                      {task.dueAt ? <p className="body-sm">{formatManila(task.dueAt, "d MMM yyyy, h:mm a")}</p> : <p className="body-sm rec-muted">No deadline</p>}
                      {due ? <StatusBadge tone={due.tone} label={due.label} /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
