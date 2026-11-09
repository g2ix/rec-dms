import { headers } from "next/headers";
import { AuthFrame } from "@/components/auth/auth-frame";
import { redirectAwayFromAuthEntry } from "@/server/auth/gate";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const headerList = await headers();
  const pathname = headerList.get("x-rec-pathname");
  if (pathname) {
    await redirectAwayFromAuthEntry(pathname, headerList.get("x-rec-search") ?? "");
  }
  if (pathname === "/sign-in") return children;
  return <AuthFrame>{children}</AuthFrame>;
}
