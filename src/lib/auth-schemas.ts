import { z } from "zod";

const namePart = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(80)
  .regex(/^[\p{L}][\p{L}\s.'-]*$/u, "Use letters, spaces, apostrophes, or hyphens.");

export const signUpSchema = z.object({
  firstName: namePart,
  middleInitial: z
    .string()
    .trim()
    .max(2)
    .regex(/^[A-Za-z]{0,2}$/, "Use one or two letters.")
    .optional()
    .or(z.literal("")),
  familyName: namePart,
  email: z.string().trim().email("Enter a valid email address.").max(200),
  password: z.string().min(12, "Use at least 12 characters.").max(200),
});

export const signInSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export const emailOnlySchema = z.object({
  email: z.string().trim().email("Enter a valid email address.").max(200),
});

export const codeSchema = z.object({
  email: z.string().trim().email(),
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code."),
});

const institution = z.string().trim().min(1, "Enter the institution.").max(160);

export const studentAffiliationSchema = z.object({
  kind: z.literal("STUDENT"),
  course: z.string().trim().min(1, "Enter the course.").max(120),
  yearLabel: z.string().trim().min(1, "Enter the year.").max(40),
  institution,
  contactEmailId: z.string().uuid(),
});

export const facultyAffiliationSchema = z.object({
  kind: z.literal("FACULTY"),
  position: z.string().trim().min(1, "Enter the position.").max(120),
  unit: z.string().trim().min(1, "Enter the unit.").max(160),
  institution,
  contactEmailId: z.string().uuid(),
});

export const affiliationSchema = z.discriminatedUnion("kind", [
  studentAffiliationSchema,
  facultyAffiliationSchema,
]);

export const createProtocolSchema = z.object({
  title: z.string().trim().min(1, "Enter the protocol title.").max(300),
  affiliation: affiliationSchema,
});
