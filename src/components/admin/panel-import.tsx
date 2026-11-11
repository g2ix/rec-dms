"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BusyButton } from "@/components/ui/busy-button";
import { ROLE_KEY_LABEL, isRoleKey } from "@/lib/forms/roles";
import type { ImportRow } from "@/lib/panels/import";
import type { PlanItem } from "@/server/users/panel-import";
import { applyPanelImportAction, previewPanelImportAction } from "@/server/users/panel-import-actions";

function role(key: string): string {
  return isRoleKey(key) ? ROLE_KEY_LABEL[key] : key;
}

function describe(item: PlanItem): string {
  if (item.kind === "panel") return `New panel ${item.panelName} (${item.panelCode})`;
  if (item.kind === "new") return `${item.panelCode} · ${item.name} <${item.email}> · new account, invited · ${role(item.roleKey)} · ${item.designation}`;
  if (item.kind === "grant") return `${item.panelCode} · ${item.name} · added as ${role(item.roleKey)} · ${item.designation}`;
  if (item.kind === "change") {
    return `${item.panelCode} · ${item.name} · ${role(item.fromRole)} (${item.fromDesignation || "no designation"}) → ${role(item.roleKey)} (${item.designation})`;
  }
  if (item.kind === "remove") return `${item.panelCode} · ${item.name} · ${role(item.roleKey)} revoked, reason “Panel list import”`;
  return `Row ${item.sheetRow} skipped · ${item.reason}`;
}

const GROUPS: { kind: PlanItem["kind"]; title: string }[] = [
  { kind: "panel", title: "Panels to create" },
  { kind: "new", title: "New people" },
  { kind: "grant", title: "Added to a panel" },
  { kind: "change", title: "Designation changes" },
  { kind: "remove", title: "Removed" },
  { kind: "skip", title: "Rows not imported" },
];

/** Upload the members spreadsheet, read the preview, then confirm. Nothing changes until confirmed. */
export function PanelImport() {
  const router = useRouter();
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);

  async function preview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("preview");
    setMessage(null);
    const result = await previewPanelImportAction(new FormData(event.currentTarget));
    setBusy(null);
    if (!result.ok) {
      setRows(null);
      setMessage(result.error);
      return;
    }
    setRows(result.rows);
    setPlan(result.plan);
  }

  async function apply() {
    if (!rows) return;
    setBusy("apply");
    const result = await applyPanelImportAction(rows);
    setBusy(null);
    setMessage(result.ok ? result.summary : result.error);
    if (result.ok) {
      setRows(null);
      setPlan([]);
      router.refresh();
    }
  }

  const changes = plan.filter((item) => item.kind !== "skip").length;
  return (
    <section className="rec-card rec-stack" aria-labelledby="panel-import">
      <h2 className="heading" id="panel-import">
        Import from a spreadsheet
      </h2>
      <p className="body-sm rec-muted">
        Columns: Panel, No., Name, Designation, Discipline, Affiliation, Email, and an optional second email. Open tasks are not moved.
      </p>
      <form onSubmit={preview} className="rec-form">
        <label className="rec-field">
          <span className="label">Members workbook (.xlsx)</span>
          <input className="rec-input" type="file" name="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
        </label>
        <BusyButton type="submit" variant="secondary" busy={busy === "preview"} busyLabel="Reading…">
          Preview changes
        </BusyButton>
      </form>
      {message ? (
        <p className="body-sm" role="status">
          {message}
        </p>
      ) : null}
      {rows ? (
        <div className="rec-stack">
          {changes === 0 ? <p className="body">The panels already match this file. Nothing would change.</p> : null}
          {GROUPS.map((group) => {
            const items = plan.filter((item) => item.kind === group.kind);
            if (items.length === 0) return null;
            return (
              <div key={group.kind} className="rec-stack">
                <h3 className="subheading">
                  {group.title} ({items.length})
                </h3>
                <ul className="rec-methods">
                  {items.map((item, index) => (
                    <li key={`${group.kind}-${index}`}>
                      <p className="body-sm">{describe(item)}</p>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {changes > 0 ? (
            <BusyButton type="button" variant="primary" busy={busy === "apply"} busyLabel="Importing…" onClick={apply}>
              Apply {changes} {changes === 1 ? "change" : "changes"}
            </BusyButton>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
