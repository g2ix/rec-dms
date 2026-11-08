import { BlurLoad } from "@/components/ui/blur-load";

export default function Loading() {
  return (
    <BlurLoad
      state="loading"
      placeholder={
        <div className="details-page" aria-hidden="true">
          <div className="details-intro">
            <span className="rec-bar rec-bar--lg" />
            <span className="rec-bar" />
          </div>
          <div className="details-layout">
            <div className="details-form">
              <div className="form-section">
                <div className="form-section__head">
                  <span className="rec-bar" />
                </div>
                <div className="form-section__body">
                  <span className="rec-bar" />
                  <span className="rec-bar" />
                  <span className="rec-bar" />
                </div>
              </div>
              <div className="form-section">
                <div className="form-section__head">
                  <span className="rec-bar" />
                </div>
                <div className="form-section__body">
                  <span className="rec-bar" />
                  <span className="rec-bar" />
                </div>
              </div>
            </div>
            <div className="details-preview">
              <span className="rec-bar" />
              <span className="rec-bar rec-bar--lg" />
            </div>
          </div>
        </div>
      }
    >
      {null}
    </BlurLoad>
  );
}
