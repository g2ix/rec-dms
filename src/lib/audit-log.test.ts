import { describe, expect, it } from "vitest";
import { AuditAction, chainStatusLabel, isInternalAuditAction } from "@/lib/audit-log";
import { AUDIT_REDACTED, diffOf } from "@/server/audit/diff";

describe("audit diff", () => {
  it("keeps only changed keys and redacts secrets", () => {
    expect(
      diffOf(
        { status: "PENDING_APPROVAL", passwordHash: "old-hash", code: "USC-REC-2026-0001" },
        { status: "ACTIVE", passwordHash: "new-hash", code: "USC-REC-2026-0001" },
      ),
    ).toEqual({
      status: { before: "PENDING_APPROVAL", after: "ACTIVE" },
      passwordHash: { before: AUDIT_REDACTED, after: AUDIT_REDACTED },
    });

    const nested = diffOf(
      { access_token: "tok-a", profile: { refresh_token: "r1", name: "Ana" } },
      { access_token: "tok-b", profile: { refresh_token: "r2", name: "Ana" } },
    );
    expect(JSON.stringify(nested)).not.toContain("tok-");
    expect(JSON.stringify(nested)).not.toContain("r1");
    expect(nested.profile).toEqual({
      before: { refresh_token: AUDIT_REDACTED, name: "Ana" },
      after: { refresh_token: AUDIT_REDACTED, name: "Ana" },
    });
    expect(diffOf({ code: "123456" }, { code: "654321" }).code).toEqual({
      before: AUDIT_REDACTED,
      after: AUDIT_REDACTED,
    });
  });
});

describe("audit visibility", () => {
  it("hides account and role actions from the proponent timeline", () => {
    expect(isInternalAuditAction(AuditAction.signIn)).toBe(true);
    expect(isInternalAuditAction(AuditAction.roleGranted)).toBe(true);
    expect(isInternalAuditAction(AuditAction.settingChanged)).toBe(true);
    expect(isInternalAuditAction("protocol.submitted")).toBe(false);
  });

  it("names the chain status with the last sequence", () => {
    expect(chainStatusLabel({ ok: true, seq: BigInt(12345) }, "02:00").label).toBe(
      "Chain verified up to #12,345 at 02:00",
    );
    expect(chainStatusLabel({ ok: false, seq: BigInt(4) }, "02:00").tone).toBe("danger");
  });
});
