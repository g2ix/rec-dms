import Link from "next/link";
import { OpenStoredFileButton } from "@/components/docs/document-open";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { FormProgress } from "@/lib/protocols/format";
import { prisma } from "@/server/db";
import { listWorkingForms } from "@/server/protocols/read";

const TONE: Record<FormProgress, StatusTone> = {
  "Not started": "draft",
  "In progress": "info",
  Complete: "success",
  "Needs signatures": "warning",
};

const KIND_LABEL: Record<string, string> = {
  MANUSCRIPT: "Research proposal / manuscript",
  COVER_LETTER: "Cover letter",
  SUPPORTING: "Supporting file",
  RECEIPT: "Payment receipt",
};

/** Forms REC Staff fill themselves; they are not something the proponents left out. */
const STAFF_FORMS = new Set(["F-26"]);

/**
 * Everything REC Staff need to screen a submission, on the task itself: the files with an Open
 * button, the forms with their state, and what is missing. F-26 is filled from this evidence.
 */
export async function ScreeningPanel({
  protocolId,
  userId,
  requiredUploads,
}: {
  protocolId: string;
  userId: string;
  requiredUploads: string[];
}) {
  const version = await prisma.protocolVersion.findFirst({
    where: { protocolId, state: "WORKING" },
    select: { id: true, label: true },
  });
  if (!version) return null;
  const [allFiles, forms] = await Promise.all([
    prisma.storedFile.findMany({
      where: { protocolVersionId: version.id },
      orderBy: [{ kind: "asc" }, { createdAt: "desc" }],
      select: { id: true, kind: true, originalName: true, size: true, scanStatus: true },
    }),
    listWorkingForms(userId, protocolId),
  ]);
  // Printouts of the forms (GENERATED_PDF, GENERATED_DOCX) are opened from the Forms list instead.
  const files = allFiles.filter((file) => !file.kind.startsWith("GENERATED"));
  const present = new Set<string>(files.filter((file) => file.scanStatus !== "INFECTED").map((file) => file.kind));
  const missingUploads = requiredUploads.filter((kind) => !present.has(kind));
  const proponentForms = forms.filter((form) => !STAFF_FORMS.has(form.code));
  const staffForms = forms.filter((form) => STAFF_FORMS.has(form.code));
  // F-35 and F-36 stay "In progress" until the reviewers fill their part, and intake forms are
  // checked when the proponents submit; flag only missing signatures and forms never started.
  const unfinished = proponentForms.filter(
    (form) => form.progress === "Needs signatures" || (form.progress === "Not started" && !form.intakeSourced),
  );
  const problems = missingUploads.length + unfinished.length;

  return (
    <section className="rec-card rec-stack rec-screening" aria-labelledby="screening-heading">
      <div className="rec-card__head">
        <h3 id="screening-heading" className="subheading">
          Check the submission
        </h3>
        <StatusBadge
          tone={problems === 0 ? "success" : "warning"}
          label={problems === 0 ? "Nothing missing" : `${problems} item${problems === 1 ? "" : "s"} to check`}
        />
      </div>
      <p className="body-sm rec-muted">
        Version {version.label}. Open each file and form below. The Document Receipt Form (F-26) is already filled in from what was
        submitted; confirm or correct it before you decide.
      </p>

      {missingUploads.length > 0 || unfinished.length > 0 ? (
        <ul className="rec-screening__missing body-sm">
          {missingUploads.map((kind) => (
            <li key={`u-${kind}`}>Missing: {KIND_LABEL[kind] ?? kind}</li>
          ))}
          {unfinished.map((form) => (
            <li key={`f-${form.instanceId}`}>
              {form.code} {form.title}: {form.progress.toLowerCase()}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="rec-screening__grid">
        <div className="rec-stack">
          <h4 className="label">Files</h4>
          {files.length === 0 ? <p className="body-sm">No files were uploaded.</p> : null}
          <ul className="rec-screening__list">
            {files.map((file) => (
              <li key={file.id} className="rec-screening__row">
                <div className="rec-screening__text">
                  <span className="body-sm">{KIND_LABEL[file.kind] ?? file.kind}</span>
                  <span className="caption rec-muted">
                    {file.originalName} · {Math.ceil(file.size / 1024)} KB
                  </span>
                </div>
                {file.scanStatus === "INFECTED" ? (
                  <StatusBadge tone="danger" label="Blocked" />
                ) : (
                  <OpenStoredFileButton fileId={file.id} protocolId={protocolId} />
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="rec-stack">
          <h4 className="label">Forms</h4>
          <ul className="rec-screening__list">
            {[...staffForms, ...proponentForms].map((form) => (
              <li key={form.instanceId} className="rec-screening__row">
                <div className="rec-screening__text">
                  <span className="body-sm">
                    <span className="code">{form.code}</span> {form.title}
                  </span>
                  {STAFF_FORMS.has(form.code) ? <span className="caption rec-muted">Filled in for you; confirm it</span> : null}
                </div>
                <div className="rec-inline">
                  <StatusBadge tone={TONE[form.progress]} label={form.progress} />
                  <Link className="rec-link body-sm" href={`/app/protocols/${protocolId}/forms/${form.instanceId}`}>
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
