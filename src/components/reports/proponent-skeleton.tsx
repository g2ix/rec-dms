import { PlaceholderBar } from "@/components/ui/placeholder-bar";

export function ProponentDashboardSkeleton() {
  return (
    <div className="rec-dash" aria-hidden="true">
      <div className="rec-dash-head">
        <div className="rec-dash-skel__title">
          <PlaceholderBar width="180px" />
          <PlaceholderBar width="160px" className="rec-bar--lg" />
        </div>
      </div>
      <div className="rec-strip">
        {["waiting", "revisions", "protocols"].map((key) => (
          <div key={key} className="rec-strip__cell">
            <PlaceholderBar width="48px" className="rec-bar--lg" />
            <PlaceholderBar width="120px" />
            <PlaceholderBar width="90%" />
          </div>
        ))}
      </div>
      <div className="rec-dash__grid">
        <div className="rec-dash__main">
          <div className="rec-card rec-dash-card rec-dash-skel">
            <PlaceholderBar width="220px" />
            <PlaceholderBar width="100%" />
            <PlaceholderBar width="92%" />
            <PlaceholderBar width="80%" />
          </div>
          <div className="rec-card rec-dash-card rec-dash-skel">
            <PlaceholderBar width="160px" />
            <PlaceholderBar width="100%" />
            <PlaceholderBar width="100%" />
            <PlaceholderBar width="70%" />
          </div>
        </div>
        <div className="rec-dash__side">
          <div className="rec-card rec-dash-card rec-dash-skel">
            <PlaceholderBar width="140px" />
            <PlaceholderBar width="100%" />
            <PlaceholderBar width="88%" />
            <PlaceholderBar width="76%" />
          </div>
        </div>
      </div>
    </div>
  );
}
