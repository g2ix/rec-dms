import { describe, expect, it } from "vitest";
import { findAuthzGaps } from "@/lib/authz-surface";

describe("authorization surface", () => {
  it("gates every server action and route", () => {
    expect(findAuthzGaps()).toEqual([]);
  });
});
