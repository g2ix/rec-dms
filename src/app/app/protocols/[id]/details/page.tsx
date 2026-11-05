import { DetailsForm } from "@/components/protocols/details-form";
import { changePanelAction } from "@/server/protocols/actions";
import { boundValues, listPanels, protocolHeader } from "@/server/protocols/read";
import { requireUser } from "@/server/session";

export default async function ProtocolDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const [header, bound, panels] = await Promise.all([protocolHeader(user.id, id), boundValues(id), listPanels()]);
  const funding = Array.isArray(header.protocol.fundingSources)
    ? header.protocol.fundingSources.flatMap((item) => {
        if (item && typeof item === "object" && "name" in item && typeof item.name === "string") return [item.name];
        return [];
      })
    : [];
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
          researchType: header.protocol.researchType,
          durationMonths: header.protocol.durationMonths,
          expectedParticipants: header.protocol.expectedParticipants,
          studySite: header.protocol.studySite,
          funding,
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
