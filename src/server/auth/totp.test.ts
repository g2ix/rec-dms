import { describe, expect, it } from "vitest";
import { newTotpSecret, totpQrSvg, totpUri } from "@/server/auth/totp";

describe("authenticator setup", () => {
  it("names the account USC REC-DMS in authenticator apps", () => {
    const uri = new URL(totpUri("gran.sabandal@usc.edu.ph", "JBSWY3DPEHPK3PXP"));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.host).toBe("totp");
    expect(decodeURIComponent(uri.pathname)).toBe("/USC REC-DMS:gran.sabandal@usc.edu.ph");
    expect(uri.searchParams.get("issuer")).toBe("USC REC-DMS");
    expect(uri.searchParams.get("secret")).toBe("JBSWY3DPEHPK3PXP");
  });

  it("draws a scannable QR code as SVG", async () => {
    const svg = await totpQrSvg(totpUri("someone@usc.edu.ph", newTotpSecret()));
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<path");
    expect(svg).not.toContain("<script");
  });
});
