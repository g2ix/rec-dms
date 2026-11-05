import { cookies } from "next/headers";
import { AppShell } from "@/components/shell/app-shell";

export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const collapsed = jar.get("sidebar")?.value === "rail";
  return <AppShell collapsed={collapsed}>{children}</AppShell>;
}
