import { DetailsForm } from "@/components/protocols/details-form";
import { changePanelAction } from "@/server/protocols/actions";
import { boundValues, listPanels, protocolHeader } from "@/server/protocols/read";
import { requireUser } from "@/server/session";

export default async function ProtocolDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const [header, bound, panels] = await Promise.all([protocolHeader(user.id, id), boundValues(id), listPanels()]);
  const storedFunding = Array.isArray(header.protocol.fundingSources) ? header.protocol.fundingSources : [];
  const funding = storedFunding.flatMap((item) => {
    if (!item || typeof item !== "object" || !("code" in item) || typeof item.code !== "string") return [];
    const detail = "detail" in item && typeof item.detail === "string" ? item.detail : "";
    return [{ code: item.code, detail }];
  });
  const legacyFunding = storedFunding.flatMap((item) => {
    if (!item || typeof item !== "object" || !("name" in item) || typeof item.name !== "string") return [];
    if ("code" in item && typeof item.code === "string" && item.code) return [];
    return [item.name];
  });
  const researchers = Array.isArray(bound["protocol.researchers"])
    ? bound["protocol.researchers"].filter((item): item is string => typeof item === "string")
    : [];
  const canEdit = header.mine?.status === "ACTIVE" && (header.mine.role === "PROPONENT" || header.mine.role === "ADVISER");
  return (
    <div className="rec-stack">
      <DetailsForm
        protocolId={id}
        locked={!header.working || !canEdit}
        researchers={researchers}
        values={{
          title: header.protocol.title,
          institution: header.protocol.institution,
          institutionAddress: header.protocol.institutionAddress,
          researchTypeCodes: header.protocol.researchTypeCodes,
          researchTypeOther: header.protocol.researchTypeOther,
          legacyResearchType: header.protocol.researchTypeCodes.length === 0 ? header.protocol.researchType : "",
          durationMonths: header.protocol.durationMonths,
          expectedParticipants: header.protocol.expectedParticipants,
          studySite: header.protocol.studySite,
          funding,
          legacyFunding,
        }}
      />
      <section className="rec-card rec-stack">
        <h2 className="heading">Review panel</h2>
        <p className="body">
          {header.protocol.discipline ? `${header.protocol.discipline.name} suggests ` : "Suggested panel "}
          <strong>{header.protocol.panel?.name ?? "not set"}</strong>.
        </p>
        {header.staff ? (
          <form action={changePanelAction} className="rec-form">
            <input type="hidden" name="protocolId" value={id} />
            <label className="label" htmlFor="panel">
              Panel
            </label>
            <select id="panel" name="panelId" className="rec-select" defaultValue={header.protocol.panelId ?? ""}>
              {panels.map((panel) => (
                <option key={panel.id} value={panel.id}>
                  {panel.name}
                </option>
              ))}
            </select>
            <button className="rec-btn rec-btn--secondary" type="submit">
              <span>Save panel</span>
            </button>
          </form>
        ) : (
          <p className="body-sm rec-muted">REC Staff or the Chair can change the panel.</p>
        )}
      </section>
    </div>
  );
}
