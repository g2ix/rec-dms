import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FormBuilder } from "@/components/forms/form-builder";
import { FormStatusBadge } from "@/components/forms/form-status";
import { validateSchema, type FormSchema } from "@/lib/forms/schema";
import { authorize } from "@/server/authz";
import { AppError } from "@/server/errors";
import { saveTemplateAction } from "@/server/forms/actions";
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
      {definition.status === "RETIRED" ? null : (
        <form action={saveTemplateAction} className="rec-stack" encType="multipart/form-data">
          <input type="hidden" name="id" value={definition.id} />
          <h2 className="heading">Word template</h2>
          <p className="body-sm">
            Upload the official .docx and the placeholder map. Every tag in the file must be mapped, and every field on the form must be covered.
          </p>
          <label className="rec-field">
            <span className="rec-field__label">Template file</span>
            <input className="rec-input" type="file" name="template" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />
          </label>
          <label className="rec-field">
            <span className="rec-field__label">Placeholder map</span>
            <textarea
              className="rec-input rec-textarea"
              name="placeholderMap"
              rows={12}
              defaultValue={JSON.stringify(definition.placeholderMap ?? {}, null, 2)}
            />
          </label>
          <div className="rec-actions">
            <button className="rec-btn rec-btn--primary" type="submit">
              <span>Save template</span>
            </button>
          </div>
        </form>
      )}
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
