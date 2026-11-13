"use client";

import { Check, CircleAlert } from "lucide-react";
import { Icon } from "@/components/icons";
import { goToSection } from "@/components/protocols/intake/rail";
import { SubmitStepForm } from "@/components/protocols/submit-step-card";
import type { RailKey } from "@/lib/intake/rail";
import { completeTaskAction } from "@/server/workflow/actions";

/**
 * Fixed to the bottom of the Intake page. With items missing it says how many and links to the
 * first; with none left the leader gets the submit button, with the existing confirmation dialog.
 * The page reserves its height at the bottom, so it never covers content.
 */
export function SubmitBar({
  protocolId,
  missing,
  firstSection,
  accountApproved,
  leader,
  submit,
}: {
  protocolId: string;
  missing: number;
  firstSection: RailKey | null;
  accountApproved: boolean;
  leader: boolean;
  submit: { taskId: string; to: "ADVISER" | "REC"; ready: boolean } | null;
}) {
  const label = submit?.to === "ADVISER" ? "Submit to adviser" : "Submit to REC";
  return (
    <div className="rec-submit-bar" role="region" aria-label="Submit" data-testid="submit-bar">
      <div className="rec-submit-bar__inner">
        {missing > 0 ? (
          <a
            className="rec-intake-status rec-intake-status--missing rec-submit-bar__left label rec-touch"
            href={firstSection ? `#${firstSection}` : "#"}
            onClick={(event) => {
              if (!firstSection) return;
              event.preventDefault();
              goToSection(firstSection);
            }}
            aria-live="polite"
          >
            <Icon icon={CircleAlert} size={16} />
            {missing === 1 ? "1 item left" : `${missing} items left`}
          </a>
        ) : (
          <p className="rec-intake-status rec-intake-status--done label" aria-live="polite">
            <Icon icon={Check} size={16} />
            {accountApproved ? "Ready to submit" : "Ready. Your account needs approval before you can submit."}
          </p>
        )}
        {missing === 0 && leader && submit && accountApproved ? (
          <SubmitStepForm action={completeTaskAction} taskId={submit.taskId} protocolId={protocolId} ready={submit.ready} summary="" submitLabel={label} compact />
        ) : missing === 0 && !leader ? (
          <p className="body-sm rec-muted">Only the project leader can submit.</p>
        ) : null}
      </div>
    </div>
  );
}
