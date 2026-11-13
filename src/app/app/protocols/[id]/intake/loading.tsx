import { BlurLoad } from "@/components/ui/blur-load";
import { PlaceholderBar } from "@/components/ui/placeholder-bar";

/** The Intake page's real layout (rail beside the sections), blurred until the data arrives. */
export default function Loading() {
  return (
    <BlurLoad
      state="loading"
      placeholder={
        <div className="rec-intake">
          <div className="rec-intake__grid">
            <div className="rec-intake-rail">
              <div className="rec-stack">
                {Array.from({ length: 8 }, (_, index) => (
                  <PlaceholderBar key={index} width="80%" />
                ))}
              </div>
            </div>
            <div className="rec-intake__body rec-stack">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="rec-card rec-stack">
                  <PlaceholderBar width="40%" />
                  <PlaceholderBar />
                  <PlaceholderBar width="70%" />
                </div>
              ))}
            </div>
          </div>
        </div>
      }
    >
      {null}
    </BlurLoad>
  );
}
