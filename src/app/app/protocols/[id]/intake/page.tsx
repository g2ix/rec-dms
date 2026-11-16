import Link from "next/link";
import { IntakeForm } from "@/components/protocols/intake-form";
import { TeamCard } from "@/components/protocols/overview-cards";
import { F27_COI, F27_DECLARATIONS, F28_CONSENTS } from "@/lib/intake/wording";
import { estimateEthicsFee } from "@/server/intake/fee";
import { intakePageExtras } from "@/server/intake/page";
import { readIntakeView } from "@/server/intake/service";
import { intakeStateOf } from "@/server/intake/state";
import { boundValues, protocolHeader } from "@/server/protocols/read";
import { DetailsForm } from "@/components/protocols/details-form";
import { requireUser } from "@/server/session";
import { ReturnedView, type ReturnedData } from "@/components/protocols/intake/returned-view";
import { formatManila } from "@/lib/time";
import { returnedView, type ReturnedView as ReturnedViewModel, type UploadRow } from "@/server/revision/returned";

type Header = Awaited<ReturnType<typeof protocolHeader>>;

/**
 * Versions on the earlier forms have no Study section, so the shared study details are edited
 * here, on the same tab as intake versions (the Details tab was folded into the Intake tab).
 */
async function LegacyStudyDetails({ protocolId, header }: { protocolId: string; header: Header }) {
  const bound = await boundValues(protocolId);
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
    <DetailsForm
      protocolId={protocolId}
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
  );
}

function fileRow(file: UploadRow) {
  return { id: file.id, kind: file.kind, originalName: file.name, scanStatus: file.scanStatus, size: 0, tag: file.tag };
}

/** The view for the client: dates worded in Manila time, nothing else added. */
function toReturnedData(view: ReturnedViewModel): ReturnedData {
  return {
    roleLabel: view.roleLabel,
    versionNumber: view.versionNumber,
    returnedOn: view.returnedAt ? formatManila(view.returnedAt, "d MMM yyyy") : null,
    dueOn: view.dueAt ? formatManila(view.dueAt, "d MMM yyyy") : null,
    next: view.next,
    started: view.started,
    canStart: view.canStart,
    editable: view.editable,
    released: view.released,
    panelRows: view.panelRows,
    notes: view.notes.map((note) => ({ id: note.id, anchorLabel: note.anchorLabel, section: note.section, roleLabel: note.roleLabel, body: note.body, done: note.done, reply: note.reply })),
    comment: view.comment,
    manuscript: { required: view.manuscript.required, file: view.manuscript.file ? fileRow(view.manuscript.file) : null, suggestedName: view.manuscript.suggestedName },
    uploads: view.uploads.map(fileRow),
  };
}

/**
 * The Intake tab: the one place where the proponents prepare a version (INTAKE-02). F-26, F-27,
 * F-28, F-30 and the proponent columns of F-35, F-36 and F-38 are printed from it. Each section
 * keeps its data where it was: Study and Funding on the protocol, the answers in the intake, the
 * files in the uploads.
 */
export default async function ProtocolIntakePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const header = await protocolHeader(user.id, id);
  const version = header.shown;
  const [view, state, fee] = await Promise.all([
    readIntakeView(id, user.id),
    version ? intakeStateOf(version.id) : Promise.resolve(null),
    estimateEthicsFee(id),
  ]);

  // INTAKE-04: a protocol returned to the proponents opens on "Returned for revision".
  const returned = state?.usesIntake ? await returnedView(user.id, id) : null;
  const returnedData = returned ? toReturnedData(returned) : null;
  if (returnedData && !returnedData.started) {
    return (
      <section className="rec-card rec-stack" aria-label="Returned for revision">
        <ReturnedView protocolId={id} data={returnedData} actions={{}} onAction={null} maxBytes={0} />
      </section>
    );
  }

  if (!state?.usesIntake) {
    return (
      <div className="rec-stack" id="study">
        <section className="rec-card rec-stack">
          <h2 className="heading">Intake</h2>
          <p className="body">
            This protocol uses the earlier forms, so most answers are on each form. Open the <Link href={`/app/protocols/${id}/forms`}>Forms</Link> tab.
            The study details below are shared by every form.
          </p>
        </section>
        <LegacyStudyDetails protocolId={id} header={header} />
      </div>
    );
  }

  const extras = await intakePageExtras(user, id, state.versionNumber, Boolean(returnedData));
  return (
    <IntakeForm
      protocolId={id}
      editable={view.editable}
      initialRevision={view.revision}
      initialValues={view.values}
      groups={state.groups}
      actionPoints={state.actionPoints}
      fundingCodes={state.fundingCodes}
      gaps={state.gaps}
      feeEstimate={fee?.amount ?? null}
      mine={view.mine}
      wording={{ declarations: [...F27_DECLARATIONS], coi: F27_COI, consents: [...F28_CONSENTS] }}
      team={
        <TeamCard
          protocolId={id}
          members={extras.members}
          viewerId={user.id}
          manage={extras.leader}
          note={extras.leader ? null : <p className="body-sm rec-muted">The project leader manages the team on the Members tab.</p>}
        />
      }
      page={{
        rail: extras.rail,
        missingCount: extras.missing.length,
        accountApproved: extras.accountApproved,
        leader: extras.leader,
        submit: extras.submit,
        details: extras.details,
        canEditStudy: extras.canEditStudy,
        referencesOptional: state.versionNumber > 1 && !state.referencesRequired,
        documents: extras.documents,
        forms: extras.forms,
        signing: extras.signing,
        returned: returnedData,
      }}
    />
  );
}
