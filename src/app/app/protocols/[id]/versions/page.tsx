import { PdfDownload } from "@/components/docs/pdf-download";
import { formatManila } from "@/lib/time";
import { diffVersions, listVersions } from "@/server/protocols/read";
import { versionHistory } from "@/server/revision/history";
import { requireUser } from "@/server/session";

export default async function ProtocolVersionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ left?: string; right?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const user = await requireUser();
  const versions = await listVersions(user.id, id);
  const left = query.left && versions.some((version) => version.id === query.left) ? query.left : versions[0]?.id;
  const right = query.right && versions.some((version) => version.id === query.right) ? query.right : versions[versions.length - 1]?.id;
  const changes = left && right && left !== right ? await diffVersions(user.id, id, left, right) : [];
  const history = await versionHistory(user.id, id);
  return (
    <div className="rec-stack">
      <section className="rec-stack" aria-labelledby="history-heading">
        <h2 id="history-heading" className="heading">
          Versions
        </h2>
        <ol className="rec-version-list" data-testid="version-history">
          {history.map((version) => (
            <li key={version.id} className="rec-card rec-stack" data-testid={`version-${version.number}`}>
              <h3 className="subheading">
                Version {version.number} <span className="code rec-muted">{version.label}</span>
                {version.state === "WORKING" ? <span className="caption rec-muted"> · being prepared</span> : null}
              </h3>
              <ul className="rec-fix-rows">
                {version.events.map((event, index) => (
                  <li key={index} className="body-sm">
                    {formatManila(event.at, "d MMM yyyy")} · {event.label} · <span className="rec-muted">{event.by}</span>
                  </li>
                ))}
              </ul>
              {version.forms.length > 0 ? (
                <ul className="rec-preview-rows" aria-label={`Forms of version ${version.number}`}>
                  {version.forms.map((form) => (
                    <li key={form.instanceId} className="rec-preview-row">
                      <div className="rec-preview-row__name">
                        <span className="code">{form.code}</span>
                        <span className="body-sm">
                          {form.title}
                          {form.released ? " · as released" : ""}
                        </span>
                      </div>
                      <div className="rec-preview-row__actions">
                        <a className="rec-btn rec-btn--secondary" href={`/api/forms/${form.instanceId}/document?format=pdf&disposition=inline`} target="_blank" rel="noopener">
                          <span>Print</span>
                        </a>
                        <a className="rec-btn rec-btn--secondary" href={`/api/forms/${form.instanceId}/document?format=docx`}>
                          <span>DOCX</span>
                        </a>
                        <PdfDownload href={`/api/forms/${form.instanceId}/document?format=pdf`} label="PDF" />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
      <h2 className="heading">Compare versions</h2>
      <form className="rec-form" method="get">
        <label className="label" htmlFor="left">
          From version
        </label>
        <select id="left" name="left" className="rec-select" defaultValue={left}>
          {versions.map((version) => (
            <option key={version.id} value={version.id}>
              {version.label} ({version.state === "WORKING" ? "Working" : "Submitted"})
            </option>
          ))}
        </select>
        <label className="label" htmlFor="right">
          To version
        </label>
        <select id="right" name="right" className="rec-select" defaultValue={right}>
          {versions.map((version) => (
            <option key={version.id} value={version.id}>
              {version.label} ({version.state === "WORKING" ? "Working" : "Submitted"})
            </option>
          ))}
        </select>
        <button className="rec-btn rec-btn--secondary" type="submit">
          <span>Compare versions</span>
        </button>
      </form>
      {left === right ? <p className="body">Choose two different versions to see what changed.</p> : null}
      {changes.map((form) => (
        <section key={form.code} className="rec-card rec-stack">
          <h2 className="heading">
            <span className="code">{form.code}</span> {form.title}
          </h2>
          {form.changes.length === 0 ? <p className="body-sm">No field changes.</p> : null}
          <ul className="rec-methods">
            {form.changes.map((change) => (
              <li key={change.path}>
                <p className="label">{change.path}</p>
                <p className="body-sm">Earlier: {shown(change.before)}</p>
                <p className="body-sm">Later: {shown(change.after)}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function shown(value: unknown): string {
  if (value == null || value === "") return "Empty";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
