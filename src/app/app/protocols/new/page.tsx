import { ProtocolWizard } from "@/components/protocols/wizard-form";
import { suggestAffiliation } from "@/server/protocols/affiliation";
import { listDisciplines } from "@/server/protocols/read";
import { requireUser } from "@/server/session";

export const metadata = { title: "New protocol" };

export default async function NewProtocolPage() {
  const user = await requireUser();
  const [suggestions, disciplines] = await Promise.all([suggestAffiliation(user.id), listDisciplines()]);

  return (
    <article className="rec-stack">
      <h1 className="title">New protocol</h1>
      <p className="body rec-muted">
        You become the project leader. The discipline suggests a review panel. Shared details are entered once and shown on every form.
      </p>
      {suggestions.emails.length === 0 ? (
        <p className="rec-alert" role="alert">
          Verify an email before creating a protocol.
        </p>
      ) : disciplines.length === 0 ? (
        <p className="rec-alert" role="alert">
          Disciplines are not set up yet. Ask REC Staff to seed the panels.
        </p>
      ) : (
        <ProtocolWizard
          emails={suggestions.emails}
          disciplines={disciplines.map((discipline) => ({
            id: discipline.id,
            name: discipline.name,
            panelName: discipline.panel.name,
          }))}
          student={suggestions.student}
          faculty={suggestions.faculty}
        />
      )}
    </article>
  );
}
