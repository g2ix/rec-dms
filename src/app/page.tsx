import Link from "next/link";

export default function HomePage() {
  return (
    <main className="rec-content">
      <h1 className="title">USC REC-DMS</h1>
      <p className="body">
        REC-DMS replaces the email-and-Word submission process of the USC Research
        Ethics Committee with one web system. Proponents fill the REC forms once,
        reviewers assess inside the system, and every step is tracked, signed and
        logged.
      </p>
      <p className="body">
        <Link href="/sign-in">Sign in</Link>
      </p>
    </main>
  );
}
