import { redirect } from "next/navigation";

/** The Details tab was folded into the Study section of the Intake tab; old links land there. */
export default async function ProtocolDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/app/protocols/${id}/intake#study`);
}
