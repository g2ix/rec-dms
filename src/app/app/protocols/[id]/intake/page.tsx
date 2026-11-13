import Link from "next/link";
import { IntakeForm } from "@/components/protocols/intake-form";
import { TeamCard } from "@/components/protocols/overview-cards";
import { F27_COI, F27_DECLARATIONS, F28_CONSENTS } from "@/lib/intake/wording";
import { estimateEthicsFee } from "@/server/intake/fee";
import { intakePageExtras } from "@/server/intake/page";
import { readIntakeView } from "@/server/intake/service";
import { intakeStateOf } from "@/server/intake/state";
import { protocolHeader } from "@/server/protocols/read";
import { requireUser } from "@/server/session";

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

  if (!state?.usesIntake) {
    return (
      <section className="rec-card rec-stack">
        <h2 className="heading">Intake</h2>
        <p className="body">
          This protocol uses the earlier forms, so its answers are on each form. Open the <Link href={`/app/protocols/${id}/forms`}>Forms</Link> tab.
        </p>
      </section>
    );
  }

  const extras = await intakePageExtras(user, id, state.versionNumber);
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
      researchers={view.researchers}
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
      }}
    />
  );
}
