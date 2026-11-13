import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Seal } from "@/components/brand/seal";
import { Icon } from "@/components/icons";
import { ThemeIconSwitch } from "@/components/theme/theme-switch";

/**
 * The page frame every sign-in screen shares (sign in, create an account, verify email):
 * green rule, back link and theme switch, seal over a serif title, one card, then a footer.
 */
export function AuthFrame({
  title,
  subtitle = "University of San Carlos Research Ethics Committee",
  titleAs = "h1",
  footer,
  standalone = false,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  titleAs?: "h1" | "p";
  footer?: React.ReactNode;
  /** Off-page previews (the dev gallery) skip the full-height frame and the theme switch. */
  standalone?: boolean;
  children: React.ReactNode;
}) {
  const Title = titleAs;
  const Main = standalone ? "div" : "main";
  return (
    <div className={standalone ? "signin signin--preview" : "signin"}>
      <div className="site-rule" aria-hidden="true" />
      <Link className="signin-back" href="/">
        <Icon icon={ChevronLeft} size={16} />
        Back to REC-DMS
      </Link>
      {standalone ? null : (
        <div className="signin-theme">
          <ThemeIconSwitch />
        </div>
      )}
      <Main className="signin-main">
        <div className="signin-head">
          <Seal size={80} alt="" priority />
          <div className="signin-titles">
            <Title className="signin-title">{title}</Title>
            <p className="signin-sub">{subtitle}</p>
          </div>
        </div>
        <div className="signin-card">{children}</div>
        {footer ? <div className="signin-foot">{footer}</div> : null}
      </Main>
    </div>
  );
}

export function AuthLegal() {
  return (
    <p className="signin-legal">
      By signing in you agree to the <Link href="/privacy">Privacy notice</Link>. Trouble signing in? Contact the REC office.
    </p>
  );
}
