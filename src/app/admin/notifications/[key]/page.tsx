import { notFound, redirect } from "next/navigation";
import { BusyButton } from "@/components/ui/busy-button";
import { SAMPLE_VARIABLES } from "@/lib/notifications/catalog";
import { applyVariables, markdownToHtml, markdownToText } from "@/lib/notifications/render";
import { authorize } from "@/server/authz";
import { prisma } from "@/server/db";
import { ensureTemplates } from "@/server/notifications/inbox";
import { saveNotificationTemplate } from "@/server/notifications/actions";
import { requireUser } from "@/server/session";

export const metadata = { title: "Edit notification template" };

export default async function EditTemplatePage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { key } = await params;
  const { error } = await searchParams;
  const user = await requireUser();
  try {
    await authorize(user, "notification.edit");
  } catch {
    redirect("/app");
  }
  await ensureTemplates();
  const template = await prisma.notificationTemplate.findUnique({ where: { key } });
  if (!template) notFound();
  const subject = applyVariables(template.subject, SAMPLE_VARIABLES);
  const body = applyVariables(template.bodyMarkdown, SAMPLE_VARIABLES);
  const variables = Array.isArray(template.variables) ? template.variables.filter((item): item is string => typeof item === "string") : [];
  return (
    <article className="rec-stack">
      <h1 className="title">Edit template</h1>
      <p className="code">{template.key}</p>
      <p className="body rec-muted">{template.description}</p>
      {error ? (
        <p className="rec-alert" role="alert">
          {error}
        </p>
      ) : null}
      <form action={saveTemplate} className="rec-stack">
        <input type="hidden" name="key" value={template.key} />
        <label className="rec-field">
          <span className="label">Subject</span>
          <input className="rec-input" name="subject" defaultValue={template.subject} required />
        </label>
        <label className="rec-field">
          <span className="label">Message</span>
          <textarea className="rec-input" name="bodyMarkdown" rows={8} defaultValue={template.bodyMarkdown} required />
          <span className="rec-field__help">Placeholders: {variables.map((name) => `{{${name}}}`).join(", ")}</span>
        </label>
        <fieldset className="rec-stack">
          <legend className="label">Channels</legend>
          <label className="rec-choice">
            <input type="checkbox" name="channels" value="IN_APP" defaultChecked={template.channels.includes("IN_APP")} />
            <span>In the app</span>
          </label>
          <label className="rec-choice">
            <input type="checkbox" name="channels" value="EMAIL" defaultChecked={template.channels.includes("EMAIL")} />
            <span>Email</span>
          </label>
        </fieldset>
        <BusyButton type="submit" variant="primary" busyLabel="Saving…">
          Save template
        </BusyButton>
      </form>
      <section className="rec-card rec-stack rec-plate" aria-labelledby="preview-heading">
        <h2 id="preview-heading" className="heading">
          Preview
        </h2>
        <p className="caption rec-muted">Sample data, from the saved template.</p>
        <p className="subheading">{subject}</p>
        <div className="body-sm" dangerouslySetInnerHTML={{ __html: markdownToHtml(body) }} />
        <pre className="caption">{markdownToText(body)}</pre>
      </section>
    </article>
  );
}

async function saveTemplate(formData: FormData) {
  "use server";
  const key = String(formData.get("key") ?? "");
  try {
    await saveNotificationTemplate(formData);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The template could not be saved.";
    redirect(`/admin/notifications/${key}?error=${encodeURIComponent(message)}`);
  }
  redirect(`/admin/notifications/${key}`);
}
