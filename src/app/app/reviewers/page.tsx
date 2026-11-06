import Link from "next/link";
import { notFound } from "next/navigation";
import { AppError } from "@/server/errors";
import { reviewerLoadList } from "@/server/reports/lists";
import { requireUser } from "@/server/session";

export const metadata = { title: "Reviewers" };

export default async function ReviewersPage() {
  const user = await requireUser();
  try {
    const rows = await reviewerLoadList(user.id);
    return (
      <article className="rec-stack">
        <h1 className="title">Reviewers</h1>
        <p className="body rec-muted">Open assessments in your panel.</p>
        {rows.length === 0 ? <p className="body">No reviewer has an open assessment.</p> : null}
        {rows.length > 0 ? (
          <div className="rec-table-wrap">
            <table className="rec-table">
              <thead>
                <tr>
                  <th scope="col">Reviewer</th>
                  <th scope="col">Open assessments</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.name}>
                    <td>{row.name}</td>
                    <td>
                      <Link href="/app/reviewers">{row.open}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </article>
    );
  } catch (error) {
    if (error instanceof AppError && error.code === "FORBIDDEN") notFound();
    throw error;
  }
}
