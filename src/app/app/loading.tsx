import { cookies, headers } from "next/headers";
import { ProponentDashboardSkeleton } from "@/components/reports/proponent-skeleton";
import { PagePlaceholder } from "@/components/shell/page-placeholder";
import { BlurLoad } from "@/components/ui/blur-load";

export default async function Loading() {
  const headerStore = await headers();
  const jar = await cookies();
  const pathname = headerStore.get("x-rec-pathname") ?? "";
  const view = jar.get("activeView")?.value;
  const proponentHome = pathname === "/app" && (!view || view === "proponent");
  return (
    <BlurLoad state="loading" placeholder={proponentHome ? <ProponentDashboardSkeleton /> : <PagePlaceholder />}>
      {null}
    </BlurLoad>
  );
}
