import Link from "next/link";
import { formatManila } from "@/lib/time";
import { redirect } from "next/navigation";
import { FormStatusBadge } from "@/components/forms/form-status";
import { createSampleAction } from "@/server/forms/actions";
import { authorize } from "@/server/authz";
import { dateToDay, listDefinitions } from "@/server/forms/definitions";
import { requireUser } from "@/server/session";

export const metadata = { title: "Forms" };

export default async function FormsPage() {
  const user = await requireUser();
  try {
    await authorize(user, "forms.view");
  } catch {
    redirect("/app");
  }
  const definitions = await listDefinitions();

  return (
    <article className="rec-stack">
      <h1 className="title">Forms</h1>
      <p className="body rec-muted">
        A form is a versioned schema. Publish locks that version. A new version copies the schema into a draft.
      </p>
      <div className="rec-actions">
        <Link className="rec-btn rec-btn--primary" href="/admin/forms/new">
          <span>New form</span>
        </Link>
        <form action={createSampleAction}>
          <button className="rec-btn rec-btn--secondary" type="submit">
            <span>Create the sample form</span>
          </button>
        </form>
      </div>
      {definitions.length === 0 ? (
        <p className="body">No forms yet. Create one, or start from the sample form.</p>
      ) : (
        <div className="rec-table-wrap">
          <table className="rec-table">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Title</th>
                <th scope="col">Version</th>
                <th scope="col">Effective</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {definitions.map((definition) => (
                <tr key={definition.id}>
                  <td className="code">{definition.code}</td>
                  <td>{definition.title}</td>
                  <td className="code">{definition.version}</td>
                  <td>{dateToDay(definition.effectiveDate)}</td>
                  <td>
                    <FormStatusBadge status={definition.status} />
                    {definition.status === "PUBLISHED" && definition.effectiveFrom && definition.effectiveFrom.getTime() > Date.now()
                      ? ` Scheduled for ${formatManila(definition.effectiveFrom, "d MMM yyyy")}`
                      : ""}
                  </td>
                  <td>
                    <Link href={`/admin/forms/${definition.id}`}>Edit</Link>
                    {definition.status === "RETIRED" ? null : (
                      <>
                        {" · "}
                        <Link href={`/admin/forms/${definition.id}/try`}>Try</Link>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
