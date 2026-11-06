import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FormStatusBadge } from "@/components/forms/form-status";
import { SandboxForm } from "@/components/forms/sandbox-form";
import { isRoleKey, type RoleKey } from "@/lib/forms/roles";
import { validateSchema } from "@/lib/forms/schema";
import { authorize } from "@/server/authz";
import { AppError } from "@/server/errors";
import { ensureSandbox } from "@/server/forms/fill";
import { getDefinition } from "@/server/forms/definitions";
import { requireUser } from "@/server/session";
import { asDataRecord } from "@/lib/forms/paths";

export const metadata = { title: "Try form" };

export default async function TryFormPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  try {
    await authorize(user, "forms.fill");
  } catch {
    redirect("/app");
  }
  const { id } = await params;
  let definition;
  try {
    definition = await getDefinition(id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  if (definition.status === "RETIRED") {
    redirect(`/admin/forms/${definition.id}?error=${encodeURIComponent("Retired forms cannot be tried.")}`);
  }
  const check = validateSchema(definition.schema);
  if (!check.ok) {
    redirect(`/admin/forms/${definition.id}?error=${encodeURIComponent(check.issues[0]?.message ?? "Fix the schema before trying it.")}`);
  }
  const instance = await ensureSandbox(definition.id, user.id);
  const roles = instance.previewRoles.filter(isRoleKey);

  return (
    <article className="rec-stack">
      <p className="body-sm">
        <Link href={`/admin/forms/${definition.id}`}>{definition.code}</Link>
      </p>
      <p className="code">
        {definition.code} {definition.version}
      </p>
      <h1 className="title">{definition.title}</h1>
      <p>
        <FormStatusBadge status={instance.status} />
      </p>
      <div className="rec-actions">
        <a className="rec-btn rec-btn--secondary" href={`/api/forms/${instance.id}/document?format=docx`}>
          <span>Download Word</span>
        </a>
        <a className="rec-btn rec-btn--secondary" href={`/api/forms/${instance.id}/document?format=pdf`}>
          <span>Download PDF</span>
        </a>
        <a
          className="rec-btn rec-btn--secondary"
          href={`/api/forms/${instance.id}/document?format=pdf&disposition=inline`}
          target="_blank"
          rel="noreferrer"
        >
          <span>Print</span>
        </a>
      </div>
      <SandboxForm
        definitionId={definition.id}
        instanceId={instance.id}
        schema={check.schema}
        initialData={asDataRecord(instance.data)}
        initialRevision={instance.revision}
        initialStatus={instance.status}
        initialRoles={roles.length > 0 ? roles : (["PROPONENT"] as RoleKey[])}
        initialStep={instance.previewStep}
      />
    </article>
  );
}
