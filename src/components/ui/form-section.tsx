import { cn } from "@/lib/utils";

export function FormSection({
  id,
  number,
  title,
  description,
  headingId,
  className,
  children,
}: {
  id?: string;
  number: string | number;
  title: string;
  description: string;
  headingId: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn("form-section", className)} aria-labelledby={headingId}>
      <div className="form-section__head">
        <span className="form-section__step" aria-hidden="true">
          {number}
        </span>
        <div className="form-section__titles">
          <h2 id={headingId} className="heading">
            {title}
          </h2>
          <p className="form-section__description">{description}</p>
        </div>
      </div>
      <div className="form-section__body">{children}</div>
    </section>
  );
}
