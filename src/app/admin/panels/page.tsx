import { redirect } from "next/navigation";

/** Panels moved under User management. Old links and bookmarks land there. */
export default function OldPanelsPage() {
  redirect("/admin/users/panels");
}
