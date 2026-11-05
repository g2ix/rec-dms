import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FormBuilder } from "@/components/forms/form-builder";
import { FormStatusBadge } from "@/components/forms/form-status";
import { validateSchema, type FormSchema } from "@/lib/forms/schema";
import { authorize } from "@/server/authz";
import { AppError } from "@/server/errors";
import { dateToDay, getDefinition } from "@/server/forms/definitions";
import { requireUser } from "@/server/session";

export const metadata = { title: "Edit form" };

export default async function EditFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  try {
    await authorize(user, "forms.view");
  } catch {
    redirect("/app");
  }
  const { id } = await params;
  const query = await searchParams;
  let definition;
  try {
    definition = await getDefinition(id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const check = validateSchema(definition.schema);
  const schema: FormSchema = check.schema ?? { sections: [] };

  return (
    <article className="rec-stack">
      <p className="body-sm">
        <Link href="/admin/forms">Forms</Link>
        {definition.status === "RETIRED" ? null : (
          <>
            {" · "}
            <Link href={`/admin/forms/${definition.id}/try`}>Try this form</Link>
          </>
        )}
      </p>
      <p className="code">
        {definition.code} {definition.version}
      </p>
      <h1 className="title">{definition.title}</h1>
      <p>
        <FormStatusBadge status={definition.status} />
      </p>
      <FormBuilder
        id={definition.id}
        code={definition.code}
        title={definition.title}
        version={definition.version}
        effectiveDate={dateToDay(definition.effectiveDate)}
        status={definition.status}
        schema={schema}
        schemaText={JSON.stringify(definition.schema, null, 2)}
        error={query.error}
      />
    </article>
  );
}
