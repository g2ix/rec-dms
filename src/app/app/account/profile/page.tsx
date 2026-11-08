import { AccountDetailsForm } from "@/components/account/details-form";
import { middleNameForForm } from "@/lib/name-parts";
import { suggestProfileKind } from "@/lib/profile";
import { getPersonProfile, orgCatalog } from "@/server/profiles/profile";
import { requireUser } from "@/server/session";

export const metadata = { title: "Your details" };

export default async function ProfilePage() {
  const user = await requireUser();
  const [profile, catalog] = await Promise.all([getPersonProfile(user.id), orgCatalog()]);
  const schools = catalog.units.filter((unit) => unit.kind === "SCHOOL");
  return (
    <article className="details-page">
      <div className="details-intro">
        <h1 className="title">Your details</h1>
        <p className="body rec-muted">How your name and affiliation appear on the REC forms you submit.</p>
      </div>
      {schools.length === 0 ? (
        <p className="rec-alert" role="alert">
          The USC school list is not loaded yet. Ask REC Staff to seed the organization list before choosing a USC school.
        </p>
      ) : null}
      <AccountDetailsForm
        name={{
          title: user.title ?? "",
          firstName: user.firstName,
          middleName: middleNameForForm(user.middleName, user.middleInitial),
          familyName: user.familyName,
          suffix: user.suffix ?? "",
          credentials: user.credentials.join(", "),
        }}
        catalog={catalog}
        profile={profile}
        suggestedKind={profile ? null : suggestProfileKind(user.email)}
      />
    </article>
  );
}
