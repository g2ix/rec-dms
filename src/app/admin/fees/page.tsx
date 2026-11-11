import { redirect } from "next/navigation";
import { ClientTypeForm, FeeCalculator, ScheduleEditor, type ScheduleRow } from "@/components/admin/fee-admin";
import { distribute } from "@/lib/fees/calc";
import { formatCentavos } from "@/lib/forms/money";
import { authorize } from "@/server/authz";
import { billReport } from "@/server/fees/bills";
import { listFeeAdmin } from "@/server/fees/schedules";
import { requireUser } from "@/server/session";

export const metadata = { title: "Fees" };

export default async function FeesPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requireUser();
  try {
    await authorize(user, "fees.manage");
  } catch {
    redirect("/app");
  }
  const query = await searchParams;
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const from = query.from && day.test(query.from) ? query.from : undefined;
  const to = query.to && day.test(query.to) ? query.to : undefined;
  const [{ types, schedules }, report] = await Promise.all([listFeeAdmin(), billReport({ from, to })]);
  const today = new Date().toISOString().slice(0, 10);
  const rows: ScheduleRow[] = schedules.map((schedule) => ({
    id: schedule.id,
    effectiveFrom: schedule.effectiveFrom.toISOString().slice(0, 10),
    approvedRef: schedule.approvedRef,
    notes: schedule.notes,
    bills: schedule._count.bills,
    rates: schedule.rates.map((rate) => ({ clientTypeKey: rate.clientTypeKey, basis: rate.basis, amount: rate.amount })),
    rules: schedule.rules.map((rule) => ({ key: rule.key, label: rule.label, percent: rule.percent, fromRound: rule.fromRound })),
  }));
  const current = rows.find((row) => row.effectiveFrom <= today)?.id;
  return (
    <article className="rec-stack">
      <h1 className="title">Fees</h1>
      <p className="body rec-muted">
        Review fees are dated schedules. A bill is priced from the schedule in effect on the day it is issued, and keeps that amount.
      </p>
      <section className="rec-card rec-stack">
        <h2 className="heading">Client types</h2>
        {types.length === 0 ? <p className="body">No client types yet.</p> : null}
        <ul className="rec-methods">
          {types.map((type) => (
            <li key={type.key}>
              <p className="body">
                {type.label} · <span className="code">{type.key}</span>
                {type.active ? "" : " · inactive"}
              </p>
            </li>
          ))}
        </ul>
        <ClientTypeForm />
      </section>
      <section className="rec-card rec-stack">
        <h2 className="heading">Preview a bill</h2>
        <FeeCalculator types={types} />
      </section>
      {rows.map((row) => (
        <section key={row.id} className="rec-card rec-stack">
          <h2 className="heading">
            Schedule from {row.effectiveFrom}
            {row.id === current ? " · in effect" : row.effectiveFrom > today ? " · scheduled" : ""}
          </h2>
          <p className="body-sm rec-muted">{row.bills} bills issued under this schedule.</p>
          <ScheduleEditor types={types} schedule={row} />
        </section>
      ))}
      <section className="rec-card rec-stack">
        <h2 className="heading">New schedule</h2>
        <ScheduleEditor types={types} schedule={null} />
      </section>
      <section className="rec-card rec-stack">
        <h2 className="heading">Bills by month, panel, and client type</h2>
        <form className="rec-actions">
          <label className="rec-field">
            <span className="label">From</span>
            <input className="rec-input" type="date" name="from" defaultValue={from} />
          </label>
          <label className="rec-field">
            <span className="label">To</span>
            <input className="rec-input" type="date" name="to" defaultValue={to} />
          </label>
          <button type="submit" className="rec-btn rec-btn--secondary">
            <span>Show</span>
          </button>
        </form>
        <div className="rec-table-wrap">
          <table className="rec-table">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Panel</th>
                <th scope="col">Client type</th>
                <th scope="col">Bills</th>
                <th scope="col">Issued</th>
                <th scope="col">Paid</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={`${row.period}-${row.panel}-${row.clientType}`}>
                  <td>{row.period}</td>
                  <td>{row.panel}</td>
                  <td>{row.clientType}</td>
                  <td>{row.issued}</td>
                  <td>{formatCentavos(row.issuedAmount)}</td>
                  <td>{formatCentavos(row.paidAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {Object.keys(report.distribution).length > 0 ? (
          <ul className="rec-methods">
            {distribute(report.totalPaid, report.distribution).map((share) => (
              <li key={share.label}>
                <p className="body-sm">
                  {share.label} ({share.percent}%): {formatCentavos(share.amount)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="body-sm rec-muted">Set fees.distribution to split the paid total, for example by honorarium and operations.</p>
        )}
      </section>
    </article>
  );
}
