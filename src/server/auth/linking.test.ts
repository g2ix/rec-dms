import { describe, expect, it } from "vitest";
import { linkProviderAccount, removeSignInMethod, userForProviderAccount } from "@/server/auth/linking";
import { createRecAdapter } from "@/server/auth/adapter";
import { ensureVerifiedEmail } from "@/server/auth/users";
import { makeUser } from "@/server/test/users";

describe("sign-in methods", () => {
  it("refuses to remove the last sign-in method", async () => {
    const user = await makeUser({ email: "only@usc.edu.ph" });
    await expect(removeSignInMethod(user.id, { kind: "email", emailId: user.emails[0]!.id })).rejects.toMatchObject({
      code: "LAST_METHOD",
    });
  });

  it("signs in to the same user from either linked Google account", async () => {
    const user = await makeUser({
      email: "faculty.member@usc.edu.ph",
      firstName: "Luis",
      familyName: "Garcia",
    });
    await linkProviderAccount({
      userId: user.id,
      provider: "google",
      providerAccountId: "google-faculty",
      email: "faculty.member@usc.edu.ph",
    });
    await ensureVerifiedEmail(user.id, "student.member@usc.edu.ph");
    const linked = await linkProviderAccount({
      userId: user.id,
      provider: "google",
      providerAccountId: "google-student",
      email: "student.member@usc.edu.ph",
    });
    expect(linked).toEqual({ linked: true });

    const faculty = await userForProviderAccount("google", "google-faculty");
    const student = await userForProviderAccount("google", "google-student");
    expect(faculty?.id).toBe(user.id);
    expect(student?.id).toBe(user.id);

    const adapter = createRecAdapter();
    expect((await adapter.getUserByAccount?.({ provider: "google", providerAccountId: "google-faculty" }))?.id).toBe(user.id);
    expect((await adapter.getUserByAccount?.({ provider: "google", providerAccountId: "google-student" }))?.id).toBe(user.id);

    const methods = await import("@/server/auth/linking").then((module) => module.listSignInMethods(user.id));
    expect(methods.accounts.map((account) => account.email).sort()).toEqual([
      "faculty.member@usc.edu.ph",
      "student.member@usc.edu.ph",
    ]);
    await removeSignInMethod(user.id, { kind: "oauth", accountId: methods.accounts[0]!.id });
    await expect(userForProviderAccount("google", methods.accounts[0]!.providerAccountId)).resolves.toBeNull();
  });
});
