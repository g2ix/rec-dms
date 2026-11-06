import { BusyButton } from "@/components/ui/busy-button";
import { preferenceFor } from "@/server/notifications/inbox";
import { saveNotificationPreference } from "@/server/notifications/actions";
import { requireUser } from "@/server/session";

export const metadata = { title: "Notification preferences" };

export default async function NotificationPreferencesPage() {
  const user = await requireUser();
  const digest = await preferenceFor(user.id);
  return (
    <article className="rec-stack">
      <h1 className="title">Notification preferences</h1>
      <p className="body rec-muted">
        Task assignments and decisions are emailed as soon as they happen. Reminders can wait for a daily digest at 7:00 in Asia/Manila.
      </p>
      <form action={saveNotificationPreference} className="rec-stack">
        <fieldset className="rec-stack">
          <legend className="label">Email for reminders</legend>
          <label className="rec-choice">
            <input type="radio" name="digest" value="IMMEDIATE" defaultChecked={digest === "IMMEDIATE"} />
            <span>Immediate</span>
          </label>
          <label className="rec-choice">
            <input type="radio" name="digest" value="DAILY" defaultChecked={digest === "DAILY"} />
            <span>Daily digest</span>
          </label>
        </fieldset>
        <BusyButton type="submit" variant="primary" busyLabel="Saving…">
          Save preferences
        </BusyButton>
      </form>
    </article>
  );
}
