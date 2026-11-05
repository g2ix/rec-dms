import { Seal } from "@/components/brand/seal";

export function AuthFrame({
  children,
  titleAs = "h1",
}: {
  children: React.ReactNode;
  titleAs?: "h1" | "p";
}) {
  const Title = titleAs;
  return (
    <div className="auth-shell">
      <Seal size={96} />
      <Title className="display">Research Ethics Committee</Title>
      <div className="auth-card">{children}</div>
    </div>
  );
}
