import { redirect } from "next/navigation";
import { BusyButton } from "@/components/ui/busy-button";
import { authorize } from "@/server/authz";
import { requireUser } from "@/server/session";
import { removeHolidayAction, saveHolidayAction } from "@/server/workflow/actions";
import { holidayDay, listHolidays } from "@/server/workflow/holidays";

export const metadata = { title: "Holidays" };

export default async function HolidaysPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const user = await requireUser();
  try {
    await authorize(user, "holiday.edit");
  } catch {
    redirect("/app");
  }
  const holidays = await listHolidays();
  return (
    <article className="rec-stack">
      <h1 className="title">Holidays</h1>
      <p className="body rec-muted">Working-day deadlines skip these dates, and Saturday and Sunday, in Asia/Manila.</p>
      {error ? (
        <p className="rec-alert" role="alert">
          {error}
        </p>
      ) : null}
      <form action={saveHolidayAction} className="rec-actions">
        <label className="rec-field">
          <span className="label">Date</span>
          <input className="rec-input" type="date" name="date" required />
        </label>
        <label className="rec-field">
          <span className="label">Name</span>
          <input className="rec-input" name="name" required />
        </label>
        <BusyButton type="submit" variant="primary">
          Save holiday
        </BusyButton>
      </form>
      {holidays.length === 0 ? (
        <p className="body">No holidays yet.</p>
      ) : (
        <div className="rec-table-wrap">
          <table className="rec-table">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Name</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {holidays.map((holiday) => (
                <tr key={holiday.id}>
                  <td className="code">{holidayDay(holiday.date)}</td>
                  <td>{holiday.name}</td>
                  <td>
                    <form action={removeHolidayAction}>
                      <input type="hidden" name="id" value={holiday.id} />
                      <button className="rec-btn rec-btn--ghost" type="submit">
                        <span>Remove</span>
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  );
}
