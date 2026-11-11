import { ActionForm } from "@/components/ui/action-result";
import { BusyButton } from "@/components/ui/busy-button";
import { canEditWorkflow } from "@/server/authz/policy";
import { userAdminFacts } from "@/server/authz/user-admin";
import { prisma } from "@/server/db";
import { migrateInstanceAction, setMigrationAllowedAction } from "@/server/workflow/actions";
import { migrationPlan } from "@/server/workflow/engine";

/** System Admin only: move this running protocol to another published workflow version. Off until switched on. */
export async function WorkflowMigration({ protocolId, userId }: { protocolId: string; userId: string }) {
  if (!canEditWorkflow(await userAdminFacts(userId))) return null;
  const [protocol, plan] = await Promise.all([
    prisma.protocol.findUnique({ where: { id: protocolId }, select: { workflowMigrationEnabled: true } }),
    migrationPlan(protocolId),
  ]);
  if (!plan) return null;
  const enabled = Boolean(protocol?.workflowMigrationEnabled);
  return (
    <section className="rec-card rec-stack">
      <h2 className="heading">Workflow version</h2>
      <p className="body-sm">
        {plan.definitionName} · version <span className="code">{plan.versionNumber}</span> · open at {plan.currentStepKeys.join(", ") || "no step"}
      </p>
      <form action={setMigrationAllowedAction} className="rec-actions">
        <input type="hidden" name="protocolId" value={protocolId} />
        <label className="rec-choice">
          <input type="checkbox" name="allowed" defaultChecked={enabled} />
          <span>Allow moving this protocol to another version</span>
        </label>
        <BusyButton type="submit">Save</BusyButton>
      </form>
      {enabled && plan.targets.length === 0 ? <p className="body-sm rec-muted">No other published version of this workflow exists.</p> : null}
      {enabled
        ? plan.targets.map((target) => (
            <ActionForm key={target.id} action={migrateInstanceAction} className="rec-stack" submitLabel={`Move to version ${target.number}`} busyLabel="Moving…" variant="secondary">
              <input type="hidden" name="protocolId" value={protocolId} />
              <input type="hidden" name="targetVersionId" value={target.id} />
              <h3 className="subheading">Version {target.number}</h3>
              <div className="rec-table-wrap">
                <table className="rec-table">
                  <thead>
                    <tr>
                      <th scope="col">Step in this version</th>
                      <th scope="col">In version {target.number}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {target.mapping.map((row) => (
                      <tr key={row.key}>
                        <td>{row.name}</td>
                        <td>{row.kept ? "Same step key" : "Not in that version"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label className="rec-field">
                <span className="label">Resume at</span>
                <select className="rec-select" name="stepKey" defaultValue={target.steps.find((step) => plan.currentStepKeys.includes(step.key))?.key ?? ""} required>
                  <option value="">Choose…</option>
                  {target.steps
                    .filter((step) => step.type !== "END")
                    .map((step) => (
                      <option key={step.key} value={step.key}>
                        {step.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="rec-field rec-field--wide">
                <span className="label">Note on the closed tasks</span>
                <input className="rec-input" name="note" placeholder={`Moved to workflow version ${target.number}.`} />
              </label>
              <p className="body-sm rec-muted">Completed steps stay in the history. Open tasks are closed with the note, and the chosen step opens.</p>
            </ActionForm>
          ))
        : null}
    </section>
  );
}
