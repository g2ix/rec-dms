import Link from "next/link";
import { SUBMISSION_READY, SUBMISSION_STEPS } from "@/content/submission-checklist";

export const metadata = { title: "Submission guide" };

export default function SubmissionGuidePage() {
  return (
    <article className="rec-stack rec-guide">
      <h1 className="title">Submission guide</h1>
      <p className="body rec-muted">
        You can save a draft at any point and come back to it. Here is how a protocol moves through the REC.
      </p>
      <ol className="rec-guide__steps">
        {SUBMISSION_STEPS.map((step, index) => (
          <li key={step.name}>
            <span className="rec-step__name">
              {index + 1}. {step.name}
            </span>
            <span className="rec-step__detail">{step.detail}</span>
          </li>
        ))}
      </ol>
      <section className="rec-card">
        <h2 className="heading">Have these ready</h2>
        <ul className="rec-ready">
          {SUBMISSION_READY.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <Link className="rec-btn rec-btn--primary" href="/app/protocols/new">
        Start a new protocol
      </Link>
    </article>
  );
}
