import Link from "next/link";
import { IntakeForm } from "@/components/protocols/intake-form";
import { F27_COI, F27_DECLARATIONS, F28_CONSENTS } from "@/lib/intake/wording";
import { prisma } from "@/server/db";
import { estimateEthicsFee } from "@/server/intake/fee";
import { readIntakeView } from "@/server/intake/service";
import { intakeState } from "@/server/intake/state";
import { protocolHeader } from "@/server/protocols/read";
import { requireUser } from "@/server/session";

/**
 * The intake: the proponents answer it once per version. F-27, F-28, F-30 and the proponent
 * columns of F-35, F-36 and F-38 are printed from it and from the Details page (the Study section).
 */
export default async function ProtocolIntakePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const header = await protocolHeader(user.id, id);
  const version = header.shown;
  const [view, state, fee] = await Promise.all([
    readIntakeView(id, user.id),
    version ? intakeState(prisma, version.id) : Promise.resolve(null),
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
    />
  );
}
