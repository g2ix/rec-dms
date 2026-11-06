import { PagePlaceholder } from "@/components/shell/page-placeholder";
import { BlurLoad } from "@/components/ui/blur-load";

export default function RouteLoading() {
  return (
    <BlurLoad state="loading" placeholder={<PagePlaceholder />}>
      {null}
    </BlurLoad>
  );
}
