import { PlaceholderBar } from "@/components/ui/placeholder-bar";

export function PagePlaceholder() {
  return (
    <div className="dev-block" aria-hidden="true">
      <PlaceholderBar width="240px" className="rec-bar--lg" />
      <PlaceholderBar width="100%" />
      <PlaceholderBar width="72%" />
      <PlaceholderBar width="88%" />
    </div>
  );
}
