import { describe, expect, it } from "vitest";
import { postSignInPath, resolveStartPage, safeCallbackPath, safeInternalPath } from "@/lib/auth-redirect";

describe("safeCallbackPath", () => {
  it("keeps a same-site path", () => {
    expect(safeCallbackPath("/app/protocols/123")).toBe("/app/protocols/123");
    expect(safeCallbackPath("/app/protocols/123?tab=files")).toBe("/app/protocols/123?tab=files");
  });

  it("rejects absolute and protocol-relative urls", () => {
    expect(safeCallbackPath("https://example.com")).toBeNull();
    expect(safeCallbackPath("https://example.com/app")).toBeNull();
    expect(safeCallbackPath("//evil.com")).toBeNull();
    expect(safeCallbackPath("//evil.com/app")).toBeNull();
    expect(safeCallbackPath("/\\evil.com")).toBeNull();
    expect(safeCallbackPath("/%2f%2fevil.com")).toBeNull();
    expect(safeCallbackPath("/%2Fevil.com")).toBeNull();
  });
});

describe("safeInternalPath", () => {
  it("strips the app origin and still rejects other origins", () => {
    expect(safeInternalPath("http://127.0.0.1:3000/app/protocols/123", "http://127.0.0.1:3000")).toBe(
      "/app/protocols/123",
    );
    expect(safeInternalPath("https://example.com", "http://127.0.0.1:3000")).toBe("/");
  });
});

describe("resolveStartPage", () => {
  it("prefers the sign-in identity view, then the last used view, then /app", () => {
    expect(resolveStartPage({ identityDefaultView: "staff", lastUsedView: "proponent" })).toEqual({
      path: "/app",
      view: "staff",
    });
    expect(resolveStartPage({ identityDefaultView: null, lastUsedView: "reviewer" })).toEqual({
      path: "/app",
      view: "reviewer",
    });
    expect(resolveStartPage({ identityDefaultView: "not-a-view", lastUsedView: null })).toEqual({
      path: "/app",
      view: null,
    });
  });

  it("uses a stored path as the page and ignores auth-entry and off-site values", () => {
    expect(resolveStartPage({ identityDefaultView: "/app/tasks", lastUsedView: "proponent" })).toEqual({
      path: "/app/tasks",
      view: null,
    });
    expect(resolveStartPage({ identityDefaultView: null, lastUsedView: "/app/reviews?mine=1" })).toEqual({
      path: "/app/reviews?mine=1",
      view: null,
    });
    expect(resolveStartPage({ identityDefaultView: "/sign-in", lastUsedView: "chair" })).toEqual({
      path: "/app",
      view: "chair",
    });
    expect(resolveStartPage({ identityDefaultView: "https://example.com", lastUsedView: "//evil.com" })).toEqual({
      path: "/app",
      view: null,
    });
  });
});

describe("postSignInPath", () => {
  it("sends a generic home through the start-page resolver and keeps a specific path", () => {
    expect(postSignInPath("")).toBe("/");
    expect(postSignInPath("/app")).toBe("/");
    expect(postSignInPath("/")).toBe("/");
    expect(postSignInPath("/app/protocols/123")).toBe("/app/protocols/123");
    expect(postSignInPath("https://example.com")).toBe("/");
  });
});
