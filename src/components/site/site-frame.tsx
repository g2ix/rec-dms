import Link from "next/link";
import { BrandMarks } from "@/components/brand/seal";
import { ThemeIconSwitch } from "@/components/theme/theme-switch";
import { siteContent } from "@/lib/site-content";

export function SiteFrame({ children }: { children: React.ReactNode }) {
  const year = new Date().getFullYear();

  return (
    <div className="site">
      <div className="site-rule" aria-hidden="true" />
      <header className="site-header">
        <div className="site-wrap site-header__bar">
          <Link className="site-brand" href="/" aria-label={siteContent.brand.homeLabel}>
            <BrandMarks size={36} decorative priority sealClassName="site-brand__seal" />
            <span className="site-brand__text">
              <span className="site-brand__name">{siteContent.brand.name}</span>
              <span className="site-brand__unit">{siteContent.brand.unit}</span>
            </span>
          </Link>
          <nav className="site-nav" aria-label="On this page">
            {siteContent.nav.map((item) => (
              <a key={item.id} href={`/#${item.id}`}>
                {item.label}
              </a>
            ))}
          </nav>
          <div className="site-tools">
            <ThemeIconSwitch />
            <Link className="rec-btn rec-btn--secondary" href={siteContent.signIn.href}>
              {siteContent.signIn.label}
            </Link>
          </div>
        </div>
      </header>
      {children}
      <footer className="site-footer">
        <div className="site-wrap site-footer__bar">
          <p className="site-footer__name">
            <BrandMarks size={24} decorative />
            <span>{siteContent.footer.name}</span>
          </p>
          <div className="site-footer__meta">
            {siteContent.footer.links.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
            <p>
              © {year} {siteContent.footer.rightsName}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
