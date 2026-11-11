import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatManila } from "@/lib/time";
import { AppError } from "@/server/errors";
import { meetingGroups } from "@/server/reports/meetings";
import { requireUser } from "@/server/session";
import { fromZonedTime } from "date-fns-tz";

export const metadata = { title: "Meetings" };

export default async function MeetingsPage() {
  const user = await requireUser();
  let groups: Awaited<ReturnType<typeof meetingGroups>>;
  try {
    groups = await meetingGroups(user.id);
  } catch (error) {
    if (error instanceof AppError && error.code === "FORBIDDEN") notFound();
    throw error;
  }
  return (
    <article className="rec-stack">
      <h1 className="title">Meetings</h1>
      <p className="body rec-muted">
        Protocols waiting for a meeting outcome, grouped by each panel&rsquo;s meeting day from the meeting schedule setting. A full review whose documents were complete after the cutoff moves to the next meeting.
      </p>
      {groups.length === 0 ? <p className="body">No protocol is waiting for a meeting outcome.</p> : null}
      {groups.map((group) => (
        <section key={`${group.meeting ?? "none"}-${group.panelCode ?? ""}`} className="rec-stack">
          <h2 className="heading">
            {group.meeting ? formatManila(fromZonedTime(`${group.meeting}T12:00:00`, "Asia/Manila"), "EEEE, d MMMM yyyy") : "No meeting day set"}
            {group.panelName ? ` · ${group.panelName}` : ""}
          </h2>
          {group.rule ? <p className="body-sm rec-muted">{group.rule}</p> : null}
          <div className="rec-table-wrap">
            <table className="rec-table">
              <thead>
                <tr>
                  <th scope="col">Protocol</th>
                  <th scope="col">Review</th>
                  <th scope="col">Complete documents</th>
                  <th scope="col">Cutoff</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <tr key={row.protocolId}>
                    <td>
                      <Link href={`/app/protocols/${row.protocolId}`}>{row.title}</Link>
                      <p className="code">{row.code ?? "Code not assigned"}</p>
                    </td>
                    <td>{row.reviewType || "—"}</td>
                    <td>{row.completeDay ?? "—"}</td>
                    <td>{row.missedCutoff ? <StatusBadge tone="warning" label={`After the ${row.cutoffDays ?? ""}-day cutoff`} /> : "In time"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </article>
  );
}
