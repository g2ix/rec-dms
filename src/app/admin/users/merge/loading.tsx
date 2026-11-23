import { BlurLoad } from "@/components/ui/blur-load";
import { PagePlaceholder } from "@/components/shell/page-placeholder";

export default function Loading() {
  return (
    <BlurLoad state="loading" placeholder={<PagePlaceholder />}>
      {null}
    </BlurLoad>
  );
}
