import { redirect } from "next/navigation";

export default async function OldChairPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/users/panels/${id}/chair`);
}
