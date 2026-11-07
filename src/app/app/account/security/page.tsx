import { BusyButton } from "@/components/ui/busy-button";
import { beginTotpAction, challengeTotpAction, confirmTotpAction, totpSetup } from "@/server/auth/totp-actions";

export const metadata = { title: "Authenticator" };

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const setup = await totpSetup();
  const query = await searchParams;
  return (
    <article className="rec-stack">
      <h1 className="title">Authenticator</h1>
      <p className="body rec-muted">
        REC Staff, Chairs, and System Admins enter a 6-digit code from an authenticator app after they sign in. The code changes every 30 seconds.
      </p>
      {query.error ? (
        <p className="rec-alert" role="alert">
          {query.error}
        </p>
      ) : null}
      {setup.enrolled ? <ChallengeForm /> : setup.secret ? <ConfirmForm uri={setup.uri} secret={setup.secret} /> : <StartForm />}
    </article>
  );
}

function StartForm() {
  return (
    <form action={beginTotpAction}>
      <BusyButton type="submit" variant="primary">
        Set up authenticator
      </BusyButton>
    </form>
  );
}

function ConfirmForm({ uri, secret }: { uri: string | null; secret: string }) {
  return (
    <form action={confirmTotpAction} className="rec-form">
      <p className="body-sm">
        Add this key to your authenticator app. You can also paste the setup link.
      </p>
      <p className="code">{secret}</p>
      {uri ? (
        <p className="caption">
          <a href={uri}>Open the setup link</a>
        </p>
      ) : null}
      <label className="rec-field">
        <span className="label">Code</span>
        <input className="rec-input" name="code" inputMode="numeric" autoComplete="one-time-code" required />
      </label>
      <BusyButton type="submit" variant="primary">
        Turn on authenticator
      </BusyButton>
    </form>
  );
}

function ChallengeForm() {
  return (
    <form action={challengeTotpAction} className="rec-form">
      <p className="body-sm">Enter the current code to continue.</p>
      <label className="rec-field">
        <span className="label">Code</span>
        <input className="rec-input" name="code" inputMode="numeric" autoComplete="one-time-code" required />
      </label>
      <BusyButton type="submit" variant="primary">
        Continue
      </BusyButton>
    </form>
  );
}
