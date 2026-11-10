import Link from "next/link";
import { redirect } from "next/navigation";
import { authorize } from "@/server/authz";
import { listTemplates } from "@/server/notifications/inbox";
import { requireUser } from "@/server/session";

export const metadata = { title: "Notification templates" };

export default async function NotificationTemplatesPage() {
  const user = await requireUser();
  try {
    await authorize(user, "settings.edit");
  } catch {
    redirect("/app");
  }
  const templates = await listTemplates();
  return (
    <article className="rec-stack">
      <h1 className="title">Notification templates</h1>
      <p className="body rec-muted">Markdown with {"{{variables}}"}. Assignments and decisions are always emailed immediately.</p>
      <div className="rec-table-wrap">
        <table className="rec-table">
          <thead>
            <tr>
              <th scope="col">Key</th>
              <th scope="col">Description</th>
              <th scope="col">Channels</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((template) => (
              <tr key={template.id}>
                <td className="code">{template.key}</td>
                <td>{template.description}</td>
                <td>{template.channels.join(", ")}</td>
                <td>
                  <Link className="rec-btn rec-btn--ghost" href={`/admin/notifications/${template.key}`}>
                    <span>Edit</span>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}
