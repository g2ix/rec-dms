import Link from "next/link";
import { ProtocolForm } from "@/components/protocols/protocol-form";
import { isRoleKey, type RoleKey } from "@/lib/forms/roles";
import { boundValues, formForEdit } from "@/server/protocols/read";
import { requireUser } from "@/server/session";

export default async function ProtocolFormPage({
  params,
}: {
  params: Promise<{ id: string; instanceId: string }>;
}) {
  const { id, instanceId } = await params;
  const user = await requireUser();
  const [form, bound] = await Promise.all([formForEdit(user.id, id, instanceId), boundValues(id)]);
  const editing = form.version.state === "WORKING" && form.instance.status === "DRAFT" && form.roles.length > 0;
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
        roles={form.roles.filter(isRoleKey) as RoleKey[]}
        boundValues={bound}
      />
    </div>
  );
}
