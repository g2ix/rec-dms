import type { Metadata } from "next";
import { FrontPage } from "@/components/site/front-page";
import { SiteFrame } from "@/components/site/site-frame";
import { siteContent } from "@/lib/site-content";
import { redirectAwayFromAuthEntry } from "@/server/auth/gate";

export const metadata: Metadata = {
  title: { absolute: siteContent.meta.title },
  description: siteContent.meta.description,
};

export default async function HomePage() {
  await redirectAwayFromAuthEntry("/", "");
  return (
    <SiteFrame>
      <FrontPage />
    </SiteFrame>
  );
}
