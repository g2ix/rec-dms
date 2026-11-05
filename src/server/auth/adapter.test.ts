import { describe, expect, it } from "vitest";
import { createRecAdapter } from "@/server/auth/adapter";
import { ensureVerifiedEmail } from "@/server/auth/users";
import { makeUser } from "@/server/test/users";

describe("getUserByEmail", () => {
  it("resolves any verified email to the same account", async () => {
    const user = await makeUser({ email: "faculty@usc.edu.ph", firstName: "Maria", familyName: "Santos" });
    await ensureVerifiedEmail(user.id, "maria.santos@gmail.com");
    const adapter = createRecAdapter();

    expect((await adapter.getUserByEmail?.("faculty@usc.edu.ph"))?.id).toBe(user.id);
    expect((await adapter.getUserByEmail?.("maria.santos@gmail.com"))?.id).toBe(user.id);
    expect(await adapter.getUserByEmail?.("missing@usc.edu.ph")).toBeNull();
  });
});
