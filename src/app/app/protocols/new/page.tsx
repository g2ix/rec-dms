import { ProfileForm } from "@/components/account/profile-form";
import { ProtocolWizard } from "@/components/protocols/wizard-form";
import { middleNameForForm } from "@/lib/name-parts";
import { suggestProfileKind } from "@/lib/profile";
import { getPersonProfile, orgCatalog } from "@/server/profiles/profile";
import { suggestAffiliation } from "@/server/protocols/affiliation";
import { listDisciplines } from "@/server/protocols/read";
import { requireUser } from "@/server/session";

export const metadata = { title: "New protocol" };

export default async function NewProtocolPage() {
  const user = await requireUser();
  const [suggestions, disciplines, profile, catalog] = await Promise.all([
    suggestAffiliation(user.id),
    listDisciplines(),
    getPersonProfile(user.id),
    orgCatalog(),
  ]);
  const name = {
    title: user.title ?? "",
    firstName: user.firstName,
    middleName: middleNameForForm(user.middleName, user.middleInitial),
    familyName: user.familyName,
    suffix: user.suffix ?? "",
    credentials: user.credentials.join(", "),
  };

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
      ) : !profile ? (
        <ProfileForm
          name={name}
          catalog={catalog}
          profile={null}
          suggestedKind={suggestProfileKind(user.email)}
          intro="Save your details first. They are copied onto this protocol, and you can correct them for this protocol only."
        />
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
          profile={profile}
          catalog={catalog}
        />
      )}
    </article>
  );
}
