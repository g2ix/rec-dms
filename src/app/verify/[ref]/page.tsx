import { StatusBadge } from "@/components/ui/status-badge";
import { normalizeVerifyRef } from "@/lib/signatures/ref";
import { formatSignatureTime } from "@/lib/time";
import { describeVerification } from "@/server/signatures/sign";

export const metadata = { title: "Signature check" };

export default async function VerifySignaturePage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const result = await describeVerification(normalizeVerifyRef(ref));
  return (
    <main className="rec-content">
      <article className="rec-stack">
        <h1 className="title">Signature check</h1>
        {!result ? (
          <p className="body">That signature reference was not found.</p>
        ) : (
          <>
            <StatusBadge tone={result.matches ? "success" : "danger"} label={result.matches ? "Valid" : "No longer matches"} />
            <dl className="rec-stack">
              <div>
                <dt className="label">Form</dt>
                <dd className="code">{result.formCode}</dd>
              </div>
              {result.protocolCode ? (
                <div>
                  <dt className="label">Protocol</dt>
                  <dd className="code">{result.protocolCode}</dd>
                </div>
              ) : null}
              <div>
                <dt className="label">Signed by</dt>
                <dd className="body">{result.signerName}</dd>
              </div>
              <div>
                <dt className="label">Signed</dt>
                <dd className="body">{formatSignatureTime(result.signedAt)}</dd>
              </div>
            </dl>
          </>
        )}
      </article>
    </main>
  );
}
