"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Eye } from "lucide-react";
import { Icon } from "@/components/icons";
import { goToSection } from "@/components/protocols/intake/rail";

/** "Preview forms" in the protocol header: opens the generated forms on the Intake tab. */
export function PreviewFormsButton({ protocolId }: { protocolId: string }) {
  const pathname = usePathname();
  const intakePath = `/app/protocols/${protocolId}/intake`;
  return (
    <Link
      className="rec-btn rec-btn--secondary"
      href={`${intakePath}#preview`}
      onClick={(event) => {
        // Already on the Intake tab: switch to the preview without a navigation.
        if (pathname !== intakePath) return;
        event.preventDefault();
        goToSection("preview");
      }}
    >
      <Icon icon={Eye} size={16} />
      <span>Preview forms</span>
    </Link>
  );
}
