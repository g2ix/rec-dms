import { headers } from "next/headers";
import { ProponentDashboardSkeleton } from "@/components/reports/proponent-skeleton";
import { PagePlaceholder } from "@/components/shell/page-placeholder";
import { BlurLoad } from "@/components/ui/blur-load";

export default async function Loading() {
  const headerStore = await headers();
  const pathname = headerStore.get("x-rec-pathname") ?? "";
  // Every role's dashboard shares the date, the count strip and the two-column grid, so one skeleton fits all.
  const home = pathname === "/app";
  return (
    <BlurLoad state="loading" placeholder={home ? <ProponentDashboardSkeleton /> : <PagePlaceholder />}>
      {null}
    </BlurLoad>
  );
}
