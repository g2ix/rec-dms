import type { Metadata } from "next";
import { SiteFrame } from "@/components/site/site-frame";
import { siteContent } from "@/lib/site-content";

const notice = siteContent.notices.privacy;

export const metadata: Metadata = {
  title: notice.title,
  description: notice.description,
};

export default function PrivacyNoticePage() {
  return (
    <SiteFrame>
      <main className="site-wrap site-section site-prose">
        <h1 className="title">{notice.title}</h1>
        {notice.paragraphs.map((paragraph) => (
          <p key={paragraph} className="body">
            {paragraph}
          </p>
        ))}
      </main>
    </SiteFrame>
  );
}
