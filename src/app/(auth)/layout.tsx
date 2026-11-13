import { headers } from "next/headers";
import { redirectAwayFromAuthEntry } from "@/server/auth/gate";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const headerList = await headers();
  const pathname = headerList.get("x-rec-pathname");
  if (pathname) {
    await redirectAwayFromAuthEntry(pathname, headerList.get("x-rec-search") ?? "");
  }
  return children;
}
