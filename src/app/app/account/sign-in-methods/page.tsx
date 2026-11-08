import Link from "next/link";
import {
  AddEmailForm,
  ConfirmEmailForm,
  LinkGoogleForm,
  PasswordForm,
} from "@/components/account/account-forms";
import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import { removeMethodAction, setContactAction } from "@/server/auth/actions";
import { listSignInMethods } from "@/server/auth/linking";
import { requireUser } from "@/server/session";

export const metadata = { title: "Sign-in methods" };

function providerName(provider: string): string {
  if (provider === "google") return "Google";
  return provider;
}

export default async function SignInMethodsPage({
  searchParams,
}: {
  searchParams: Promise<{ pending?: string; error?: string; merged?: string }>;
}) {
  const user = await requireUser();
  const methods = await listSignInMethods(user.id);
  const query = await searchParams;

  return (
    <article className="rec-stack">
      <h1 className="title">Sign-in methods</h1>
      <p className="body rec-muted">
        Link every Google account you use at USC, including a faculty account and a student account. Each one signs in to this same account.
      </p>
      {query.merged ? <p className="rec-banner">The accounts are now one. Every linked Google account signs in here.</p> : null}
      {query.error ? (
        <p className="rec-alert" role="alert">
          {query.error}
        </p>
      ) : null}

      <section className="rec-stack">
        <h2 className="heading">Linked methods</h2>
        <ul className="rec-methods">
          {methods.accounts.map((account) => (
            <li key={account.id} className="rec-method">
              <div>
                <p className="label">
                  {providerName(account.provider)}
                  {account.email ? ` — ${account.email}` : ""}
                </p>
                <p className="caption rec-muted">Signs in to {user.displayName}</p>
              </div>
              <form action={removeMethodAction}>
                <input type="hidden" name="kind" value="oauth" />
                <input type="hidden" name="accountId" value={account.id} />
                <Button type="submit" variant="ghost">
                  Remove
                </Button>
              </form>
            </li>
          ))}
          {methods.hasPassword ? (
            <li className="rec-method">
              <p className="label">Password</p>
              <form action={removeMethodAction}>
                <input type="hidden" name="kind" value="password" />
                <Button type="submit" variant="ghost">
                  Remove
                </Button>
              </form>
            </li>
          ) : null}
          {methods.emails.map((email) => (
            <li key={email.id} className="rec-method">
              <div>
                <p className="label">{email.email}</p>
                <p className="caption rec-muted">
                  {email.isContact ? "Account contact email. " : ""}
                  {email.verified ? "Can be used for a sign-in link." : "Not verified yet."}
                </p>
              </div>
              <div className="rec-actions">
                {email.isContact ? null : (
                  <form action={setContactAction}>
                    <input type="hidden" name="emailId" value={email.id} />
                    <Button type="submit" variant="ghost">
                      Set as contact
                    </Button>
                  </form>
                )}
                <form action={removeMethodAction}>
                  <input type="hidden" name="kind" value="email" />
                  <input type="hidden" name="emailId" value={email.id} />
                  <Button type="submit" variant="ghost">
                    Remove
                  </Button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rec-stack">
        <h2 className="heading">Link another Google account</h2>
        <p className="body-sm rec-muted">Choose the Google account when the prompt opens. If it already belongs to someone else, you can merge the two accounts.</p>
        <LinkGoogleForm enabled={Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)} />
      </section>

      <section className="rec-stack">
        <h2 className="heading">Add an email</h2>
        <AddEmailForm />
        {query.pending ? <ConfirmEmailForm email={query.pending} /> : null}
      </section>

      <PasswordForm hasPassword={methods.hasPassword} />
      <p className="body-sm">
        <Link href="/app/account/profile">Your details</Link> are copied onto a protocol when you{" "}
        <Link href="/app/protocols/new">create one</Link>.
      </p>
    </article>
  );
}
