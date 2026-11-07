import { requireUser } from "@/server/session";

export const metadata = { title: "Your data" };

export default async function DataExportPage() {
  await requireUser();
  return (
    <article className="rec-stack">
      <h1 className="title">Your data</h1>
      <p className="body rec-muted">
        Download a copy of your profile, email addresses, protocol memberships, and the list of signature images saved on this account. The file does not include protocol files or other people’s data.
      </p>
      <a className="rec-btn rec-btn--primary" href="/api/account/export">
        <span>Download JSON</span>
      </a>
    </article>
  );
}
