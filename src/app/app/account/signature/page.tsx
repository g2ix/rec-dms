import { SignatureStudio } from "@/components/account/signature-studio";
import { requireUser } from "@/server/session";
import { activeSignatureView } from "@/server/signatures/store";

export const metadata = { title: "My signature" };

export default async function MySignaturePage() {
  const user = await requireUser();
  const current = await activeSignatureView(user.id);
  return (
    <article className="rec-stack">
      <h1 className="title">My signature</h1>
      <p className="body rec-muted">
        Draw a signature or upload a PNG or JPG. Saving stores a new version and the previous one stays on forms you already signed.
      </p>
      <SignatureStudio
        current={
          current
            ? {
                dataUrl: current.dataUrl,
                version: current.version,
                method: current.method,
                createdAt: current.createdAt.toISOString(),
                older: current.older,
              }
            : null
        }
      />
    </article>
  );
}
