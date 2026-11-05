import { describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { hashEmailCode, verifyEmailCode } from "@/server/auth/codes";
import { confirmRegistration, startRegistration } from "@/server/auth/register";
import { STRONG_PASSWORD } from "@/server/test/users";

describe("email codes", () => {
  it("rejects an expired code and locks the code after five attempts", async () => {
    await prisma.emailCode.create({
      data: {
        email: "expired@usc.edu.ph",
        purpose: "VERIFY_EMAIL",
        codeHash: hashEmailCode("111111"),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await expect(
      verifyEmailCode({ email: "expired@usc.edu.ph", purpose: "VERIFY_EMAIL", code: "111111" }),
    ).rejects.toMatchObject({ code: "CODE_EXPIRED" });

    await prisma.emailCode.create({
      data: {
        email: "attempts@usc.edu.ph",
        purpose: "LINK_EMAIL",
        codeHash: hashEmailCode("222222"),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        verifyEmailCode({ email: "attempts@usc.edu.ph", purpose: "LINK_EMAIL", code: "000000" }),
      ).rejects.toThrow();
    }
    await expect(
      verifyEmailCode({ email: "attempts@usc.edu.ph", purpose: "LINK_EMAIL", code: "222222" }),
    ).rejects.toMatchObject({ code: "CODE_LOCKED" });
  });
});

describe("registration approval", () => {
  it("activates a usc.edu.ph sign-up and holds a Gmail sign-up", async () => {
    const sent: string[] = [];
    const mailer = {
      async send(message: { text: string }) {
        sent.push(message.text);
      },
    };
    await startRegistration(
      {
        firstName: "Ana",
        middleInitial: "B",
        familyName: "Reyes",
        email: "ana.reyes@usc.edu.ph",
        password: STRONG_PASSWORD,
      },
      mailer,
    );
    await startRegistration(
      {
        firstName: "Ana",
        familyName: "Reyes",
        email: "ana.reyes@gmail.com",
        password: STRONG_PASSWORD,
      },
      mailer,
    );
    const uscCode = sent[0]?.match(/\d{6}/)?.[0] ?? "";
    const gmailCode = sent[1]?.match(/\d{6}/)?.[0] ?? "";
    const usc = await confirmRegistration("ana.reyes@usc.edu.ph", uscCode);
    const gmail = await confirmRegistration("ana.reyes@gmail.com", gmailCode);
    expect(usc.status).toBe("ACTIVE");
    expect(gmail.status).toBe("PENDING_APPROVAL");
  });
});
