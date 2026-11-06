import Link from "next/link";
import { ProtocolForm } from "@/components/protocols/protocol-form";
import { isRoleKey, type RoleKey } from "@/lib/forms/roles";
import { loadAuthoredRows } from "@/server/forms/authored";
import { boundValues, formForEdit } from "@/server/protocols/read";
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
  const [form, bound] = await Promise.all([formForEdit(user.id, id, instanceId), boundValues(id)]);
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
  const data = form.instance.data && typeof form.instance.data === "object" && !Array.isArray(form.instance.data)
    ? (form.instance.data as Record<string, unknown>)
    : {};
  return (
    <div className="rec-stack">
      <p className="body-sm">
        <Link href={`/app/protocols/${id}/forms`}>{form.instance.formDefinition.code}</Link>
        {" · "}
        {form.instance.formDefinition.title}
      </p>
      <ProtocolForm
        instanceId={form.instance.id}
        schema={form.schema}
        initialData={data}
        initialRevision={form.instance.revision}
        mode={editing ? "edit" : "view"}
        roles={roles}
        stepKey={form.stepKey}
        allowedRows={allowedRows}
        boundValues={bound}
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
}
