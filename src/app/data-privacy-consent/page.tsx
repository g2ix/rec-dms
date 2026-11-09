import type { Metadata } from "next";
import Link from "next/link";
import { SiteFrame } from "@/components/site/site-frame";
import { siteContent } from "@/lib/site-content";

const notice = siteContent.notices.consent;

export const metadata: Metadata = {
  title: notice.title,
  description: notice.description,
};

export default function DataPrivacyConsentPage() {
  return (
    <SiteFrame>
      <main className="site-wrap site-section site-prose">
        <h1 className="title">{notice.title}</h1>
        {notice.paragraphs.map((paragraph) => (
          <p key={paragraph} className="body">
            {paragraph}
          </p>
        ))}
        <p className="body">
          <Link className="rec-link" href={notice.action.href}>
            {notice.action.label}
          </Link>
        </p>
      </main>
    </SiteFrame>
  );
}
