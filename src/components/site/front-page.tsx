import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";
import { Seal } from "@/components/brand/seal";
import { Icon } from "@/components/icons";
import { StatusBadge } from "@/components/ui/status-badge";
import { siteContent, type SampleStepState } from "@/lib/site-content";

const stepWord: Record<SampleStepState, string> = {
  done: "Completed.",
  current: "Current stage.",
  later: "Not yet reached.",
};

export function FrontPage() {
  const { hero, sample, audiences, how, prepare, contact } = siteContent;

  return (
    <main>
      <section className="site-hero-band" aria-labelledby="site-title">
        <div className="site-wrap site-hero">
          <div className="site-hero__copy">
            <Seal size={96} alt="" priority />
            <div className="site-hero__intro">
              <p className="body-sm rec-muted">{hero.institution}</p>
              <h1 id="site-title" className="site-title">
                {hero.title}
              </h1>
              <p className="site-lead">{hero.lead}</p>
            </div>
            <div className="site-actions">
              <Link className="rec-btn rec-btn--primary site-cta" href={hero.signIn.href}>
                {hero.signIn.label}
              </Link>
              <p className="site-note">
                {hero.outside}{" "}
                <Link href={hero.create.href}>{hero.create.label}</Link>
              </p>
            </div>
          </div>
          <figure className="site-sample">
            <div className="site-sample__card">
              <div className="site-sample__meta">
                <p className="code">{sample.code}</p>
                <StatusBadge tone="info" label={sample.status} />
              </div>
              <p className="site-sample__title">{sample.title}</p>
              <ol className="site-track">
                {sample.steps.map((step, index) => {
                  const next = sample.steps[index + 1];
                  const joined = step.state === "done" && next?.state === "done";
                  return (
                    <li key={step.name} className={`site-track__item site-track__item--${step.state}`}>
                      <div className="site-track__rail" aria-hidden="true">
                        <span className="site-track__mark">
                          {step.state === "done" ? <Icon icon={Check} size={14} /> : null}
                        </span>
                        {next ? <span className={joined ? "site-track__line site-track__line--primary" : "site-track__line"} /> : null}
                      </div>
                      <div className="site-track__copy">
                        <p className="site-track__name">
                          <span className="rec-sr">{stepWord[step.state]} </span>
                          {step.name}
                        </p>
                        <p className="caption rec-muted">{step.detail}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
            <figcaption className="body-sm rec-muted">{sample.caption}</figcaption>
          </figure>
        </div>
      </section>

      <section className="site-band" aria-labelledby="site-who">
        <div className="site-wrap site-section">
          <h2 id="site-who" className="site-h2">
            {audiences.title}
          </h2>
          <div className="site-audiences">
            {audiences.columns.map((column) => (
              <article key={column.title}>
                <h3 className="heading">{column.title}</h3>
                <p className="body rec-muted">{column.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="site-plain" id={how.id} aria-labelledby="site-how">
        <div className="site-wrap site-section">
          <div className="site-section__intro">
            <h2 id="site-how" className="site-h2">
              {how.title}
            </h2>
            <p className="body rec-muted">{how.intro}</p>
          </div>
          <ol className="site-flow">
            {how.steps.map((step, index) => (
              <li key={step.name}>
                <p className="site-flow__num">{index + 1}</p>
                <hr className="site-flow__rule" />
                <p className="site-flow__name">{step.name}</p>
                <p className="body-sm rec-muted">{step.detail}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="site-band" id={prepare.id} aria-labelledby="site-prepare">
        <div className="site-wrap site-section">
          <h2 id="site-prepare" className="site-h2">
            {prepare.title}
          </h2>
          <div className="site-split">
            <div className="site-block">
              <h3 className="heading">{prepare.readyTitle}</h3>
              <ul className="rec-ready">
                {prepare.ready.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="site-block">
              <h3 className="heading">{prepare.guidesTitle}</h3>
              <ul className="site-guides">
                {prepare.guides.map((guide) => (
                  <li key={guide.label}>
                    <Link href={guide.href}>
                      <span>{guide.label}</span>
                      <Icon icon={ChevronRight} size={16} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="site-plain" id={contact.id} aria-labelledby="site-contact">
        <div className="site-wrap site-section">
          <h2 id="site-contact" className="site-h2">
            {contact.title}
          </h2>
          <dl className="site-facts">
            {contact.rows.map((row) => (
              <div key={row.term}>
                <dt>{row.term}</dt>
                <dd>{"href" in row && row.href ? <a href={row.href}>{row.detail}</a> : row.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </main>
  );
}
