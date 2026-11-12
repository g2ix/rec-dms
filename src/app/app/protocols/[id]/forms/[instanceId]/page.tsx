import Link from "next/link";
import { PdfDownload } from "@/components/docs/pdf-download";
import { ManuscriptOpenButton, ManuscriptPane } from "@/components/docs/manuscript-pane";
import { ProtocolForm } from "@/components/protocols/protocol-form";
import { CrumbLeaf } from "@/components/shell/crumbs";
import { isRoleKey, type RoleKey } from "@/lib/forms/roles";
import { loadAuthoredRows } from "@/server/forms/authored";
import { formForEdit, manuscriptForForm } from "@/server/protocols/read";
import { effectiveFormData, versionBoundValues } from "@/server/intake/bound";
import { prisma } from "@/server/db";
import { loadSignaturePanel } from "@/server/signatures/views";
import { requireUser } from "@/server/session";

export default async function ProtocolFormPage({
  params,
}: {
  params: Promise<{ id: string; instanceId: string }>;
}) {
  const { id, instanceId } = await params;
  const user = await requireUser();
  const [form, manuscript] = await Promise.all([formForEdit(user.id, id, instanceId), manuscriptForForm(user.id, id, instanceId)]);
  // Bound values of this copy's own version: frozen once submitted, live while working.
  const bound = await versionBoundValues(prisma, form.version.id);
  const roles = form.roles.filter(isRoleKey) as RoleKey[];
  const editing =
    form.instance.status !== "COMPLETE" &&
    form.roles.length > 0 &&
    (form.version.state === "WORKING" || form.stepKey != null) &&
    (form.instance.status === "DRAFT" || form.stepKey != null);
  const allowedRows = await loadAuthoredRows(prisma, user.id, form.version.id, form.schema);
  const signatures = await loadSignaturePanel({
    userId: user.id,
    hasPassword: Boolean(user.passwordHash),
    protocolId: id,
    instanceId: form.instance.id,
    schema: form.schema,
    roles,
  });
  // An intake-sourced form shows the intake and the Details page in its proponent fields, read-only.
  const data = await effectiveFormData(prisma, form.instance, bound);
  const showSplit = Boolean(manuscript && form.stepKey);

  const formBlock = (
    <div className="rec-stack">
      <CrumbLeaf label={form.instance.formDefinition.code} />
      <p className="body-sm">
        <Link href={`/app/protocols/${id}/forms`}>{form.instance.formDefinition.code}</Link>
        {" · "}
        {form.instance.formDefinition.title}
      </p>
      <div className="rec-actions">
        <a className="rec-btn rec-btn--secondary" href={`/api/forms/${form.instance.id}/document?format=docx`}>
          <span>Download Word</span>
        </a>
        <PdfDownload href={`/api/forms/${form.instance.id}/document?format=pdf`} label="Download PDF" />
        <PdfDownload
          href={`/api/forms/${form.instance.id}/document?format=pdf&disposition=inline`}
          label="View PDF"
          inline
          protocolCode={manuscript?.protocolCode ?? null}
        />
      </div>
      {manuscript && showSplit ? <ManuscriptOpenButton manuscript={manuscript} /> : null}
      <ProtocolForm
        instanceId={form.instance.id}
        schema={form.schema}
        initialData={data}
        initialRevision={form.instance.revision}
        mode={editing ? "edit" : "view"}
        roles={roles}
        stepKey={form.stepKey}
        allowedRows={allowedRows}
        boundValues={{ ...bound, "system.protocolId": id }}
        signatureSlots={signatures.byField}
        signing={{
          instanceId: form.instance.id,
          hasPassword: signatures.hasPassword,
          fresh: signatures.fresh,
          email: signatures.email,
        }}
      />
    </div>
  );

  if (showSplit && manuscript) {
    return (
      <div className="rec-review-split">
        <div className="rec-review-split__form">{formBlock}</div>
        <ManuscriptPane manuscript={manuscript} />
      </div>
    );
  }

  return formBlock;
}
