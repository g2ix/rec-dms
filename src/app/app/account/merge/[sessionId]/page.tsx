import { notFound } from "next/navigation";
import { CompleteMergeForm } from "@/components/account/merge-forms";
import { StepUpForm } from "@/components/account/account-forms";
import { sendStepUpAction } from "@/server/auth/actions";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/session";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Merge accounts" };

export default async function MergePage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const user = await requireUser();
  const { sessionId } = await params;
  const query = await searchParams;
  const session = await prisma.mergeSession.findUnique({
    where: { id: sessionId },
    include: {
      primaryUser: { include: { emails: true } },
      secondaryUser: { include: { emails: true } },
    },
  });
  if (!session || session.primaryUserId !== user.id) notFound();

  const primaryEmail = session.primaryUser.emails.find((email) => email.isContact)?.email ?? session.primaryUser.email;
  const secondaryEmail = session.secondaryUser.emails.find((email) => email.isContact)?.email ?? session.secondaryUser.email;
  const ready = Boolean(session.primaryStepUpAt && session.secondaryStepUpAt);

  return (
    <article className="rec-stack">
      <h1 className="title">Merge accounts</h1>
      <p className="body">
        {session.secondaryUser.displayName} ({secondaryEmail}) already has this sign-in method. Merging moves every identity, email, protocol membership, role, signature, notification, and task onto {session.primaryUser.displayName}. Confirm both accounts first.
      </p>
      {session.completedAt ? <p className="rec-banner">These accounts are already merged.</p> : null}
      {query.sent ? <p className="rec-banner">A code is on its way. Enter it below.</p> : null}
      {query.error ? (
        <p className="rec-alert" role="alert">
          A verified email is needed before a code can be sent.
        </p>
      ) : null}

      <section className="rec-card rec-stack">
        <h2 className="heading">Account you are keeping</h2>
        <p className="body-sm">
          {session.primaryUser.displayName} — {primaryEmail}
          {session.primaryStepUpAt ? " · Confirmed" : ""}
        </p>
        {session.primaryStepUpAt ? null : (
          <>
            <form action={sendStepUpAction}>
              <input type="hidden" name="sessionId" value={session.id} />
              <input type="hidden" name="side" value="primary" />
              <Button type="submit">Email a code</Button>
            </form>
            <StepUpForm
              sessionId={session.id}
              side="primary"
              email={primaryEmail ?? ""}
              hasPassword={Boolean(session.primaryUser.passwordHash)}
            />
          </>
        )}
      </section>

      <section className="rec-card rec-stack">
        <h2 className="heading">Account to merge in</h2>
        <p className="body-sm">
          {session.secondaryUser.displayName} — {secondaryEmail}
          {session.secondaryStepUpAt ? " · Confirmed" : ""}
        </p>
        {session.secondaryStepUpAt ? null : (
          <>
            <form action={sendStepUpAction}>
              <input type="hidden" name="sessionId" value={session.id} />
              <input type="hidden" name="side" value="secondary" />
              <Button type="submit">Email a code</Button>
            </form>
            <StepUpForm
              sessionId={session.id}
              side="secondary"
              email={secondaryEmail ?? ""}
              hasPassword={Boolean(session.secondaryUser.passwordHash)}
            />
          </>
        )}
      </section>

      {ready && !session.completedAt ? <CompleteMergeForm sessionId={session.id} /> : null}
    </article>
  );
}
