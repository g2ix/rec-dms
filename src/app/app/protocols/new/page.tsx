import { ProtocolAffiliationForm } from "@/components/protocols/affiliation-form";
import { membershipPrint, suggestAffiliation } from "@/server/protocols/affiliation";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/session";

export const metadata = { title: "New protocol" };

export default async function NewProtocolPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const user = await requireUser();
  const suggestions = await suggestAffiliation(user.id);
  const { created } = await searchParams;
  const member = created
    ? await prisma.protocolMember.findFirst({
        where: { protocolId: created, userId: user.id },
        include: { protocol: true },
      })
    : null;
  const printed = member ? await membershipPrint(member.id) : null;

  return (
    <article className="rec-stack">
      <h1 className="title">New protocol</h1>
      <p className="body rec-muted">
        Choose the email and designation for this protocol. A later protocol can use a different email and designation. The last values you saved are filled in as suggestions.
      </p>
      {printed && member ? (
        <section className="rec-card rec-stack">
          <h2 className="heading">{member.protocol.title}</h2>
          <p className="body-sm">This is how the researcher line prints on the form.</p>
          <p className="body">{printed.name}</p>
          <p className="body">{printed.designation}</p>
          <p className="body">{printed.email}</p>
        </section>
      ) : null}
      {suggestions.emails.length === 0 ? (
        <p className="rec-alert" role="alert">
          Verify an email before creating a protocol.
        </p>
      ) : (
        <ProtocolAffiliationForm emails={suggestions.emails} student={suggestions.student} faculty={suggestions.faculty} />
      )}
    </article>
  );
}
