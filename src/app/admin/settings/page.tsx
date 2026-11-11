import { redirect } from "next/navigation";
import { SettingForm } from "@/components/admin/setting-form";
import { formatManila } from "@/lib/time";
import { authorize } from "@/server/authz";
import { cancelScheduledSettingAction } from "@/server/settings/actions";
import { listSettings } from "@/server/settings/admin";
import { requireUser } from "@/server/session";

export const metadata = { title: "Settings" };

const HELP: Record<string, string> = {
  "protocol.codePattern": "Tokens {YYYY}, {###} (zero padding from the number of #), {LEADER_FAMILY}, {ET_AL}. Codes already issued never change.",
  "protocol.versionLabel": "Tokens {N}, {DDMMMYYYY}, {YYYY}, {MMM}, {MM}, {DD}.",
  "meetings.schedule": 'Per panel code: { "default": { "weekday": 5, "week": 2, "cutoffDays": 14 }, "panels": { "P1": { "weekday": 5, "week": 1, "cutoffDays": 14 } } }. Weekday 0 is Sunday; week -1 is the last.',
  "fees.distribution": 'Shares of paid fees for the report, such as { "Reviewer honorarium": 70, "Operations": 20, "Administration": 10 }.',
  "fees.description": "Bill description. Tokens {code}, {title}, {review}, {round}.",
  "fees.paymentInstructions": "Printed on the statement of account.",
  "fees.clientTypeRules": 'Suggests a client type: [{ "clientTypeKey": "...", "when": { "profileKind": "...", "academicLevel": "UNDERGRADUATE" } }].',
  "certificates.approvalPeriod": 'Such as { "amount": 1, "unit": "YEARS" }.',
  "certificates.progressReportAfter": 'Such as { "amount": 6, "unit": "MONTHS" }.',
  "certificates.continuingReviewBefore": 'Such as { "amount": 30, "unit": "DAYS" }.',
  "panels.importRoles": 'Designation words to roles for the panel import: [{ "match": "vice", "role": "PANEL_VICE_CHAIR" }, ...].',
};

export default async function SettingsPage() {
  const user = await requireUser();
  try {
    await authorize(user, "settings.data");
  } catch {
    redirect("/app");
  }
  const { rows, scheduled } = await listSettings();
  const keys = new Set(rows.map((row) => row.key));
  const suggested = Object.keys(HELP).filter((key) => !keys.has(key));
  return (
    <article className="rec-stack">
      <h1 className="title">Settings</h1>
      <p className="body rec-muted">
        Process values the workflows read. A value with a start date waits until that day; protocols already running keep what they started with
        where the setting is recorded on them.
      </p>
      {scheduled.length > 0 ? (
        <section className="rec-card rec-stack">
          <h2 className="heading">Scheduled</h2>
          <ul className="rec-methods">
            {scheduled.map((row) => (
              <li key={row.id} className="rec-actions">
                <p className="body-sm">
                  <span className="code">{row.key}</span> · Scheduled for {formatManila(row.effectiveFrom, "d MMM yyyy")} · <span className="code">{JSON.stringify(row.value)}</span>
                </p>
                <form action={cancelScheduledSettingAction}>
                  <input type="hidden" name="id" value={row.id} />
                  <button type="submit" className="rec-btn rec-btn--ghost">
                    <span>Cancel</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {rows.map((row) => (
        <section key={row.key} className="rec-card rec-stack">
          <h2 className="heading code">{row.key}</h2>
          {HELP[row.key] ? <p className="body-sm rec-muted">{HELP[row.key]}</p> : null}
          <SettingForm settingKey={row.key} value={JSON.stringify(row.value, null, 2)} fixedKey />
        </section>
      ))}
      <section className="rec-card rec-stack">
        <h2 className="heading">Add a setting</h2>
        {suggested.length > 0 ? <p className="body-sm rec-muted">Not set yet: {suggested.join(", ")}.</p> : null}
        <SettingForm settingKey="" value="" fixedKey={false} />
      </section>
    </article>
  );
}
