import Link from "next/link";
import { redirect } from "next/navigation";
import { NewForm } from "@/components/forms/new-form";
import { formatManila } from "@/lib/time";
import { authorize } from "@/server/authz";
import { requireUser } from "@/server/session";

export const metadata = { title: "New form" };

export default async function NewFormPage() {
  const user = await requireUser();
  try {
    await authorize(user, "forms.edit");
  } catch {
    redirect("/app");
  }

  return (
    <article className="rec-stack">
      <p className="body-sm">
        <Link href="/admin/forms">Forms</Link>
      </p>
      <h1 className="title">New form</h1>
      <p className="body rec-muted">The schema starts empty. You can paste a definition in the editor, or create the sample form from the list.</p>
      <NewForm today={formatManila(new Date(), "yyyy-MM-dd")} />
    </article>
  );
}
