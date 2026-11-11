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
      {setup.enrolled ? <ChallengeForm /> : setup.secret ? <ConfirmForm uri={setup.uri} secret={setup.secret} qrSvg={setup.qrSvg} /> : <StartForm />}
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

function ConfirmForm({ uri, secret, qrSvg }: { uri: string | null; secret: string; qrSvg: string | null }) {
  return (
    <form action={confirmTotpAction} className="rec-form">
      <p className="body-sm">
        Scan this QR code with your authenticator app, such as Google Authenticator or Microsoft Authenticator. It is added as <strong>USC REC-DMS</strong>.
      </p>
      {qrSvg ? (
        <div
          className="rec-totp-qr"
          role="img"
          aria-label="QR code for setting up your authenticator app"
          // The SVG is generated on the server by the qrcode package from our own otpauth link.
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />
      ) : null}
      <details className="rec-totp-manual">
        <summary className="body-sm">Can&apos;t scan? Enter the key instead</summary>
        <p className="caption rec-muted">Account name: USC REC-DMS. Key type: time-based.</p>
        <p className="code">{secret}</p>
        {uri ? (
          <p className="caption">
            <a href={uri}>Open the setup link on this device</a>
          </p>
        ) : null}
      </details>
      <label className="rec-field">
        <span className="label">Enter the 6-digit code from the app</span>
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
