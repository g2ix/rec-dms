import { diffVersions, listVersions } from "@/server/protocols/read";
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
  return (
    <div className="rec-stack">
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
