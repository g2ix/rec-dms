import { StatusBadge } from "@/components/ui/status-badge";
import { formatManila } from "@/lib/time";
import type { TaskComment } from "@/server/workflow/comments";

function byline(item: TaskComment): string {
  return [item.author, item.role, formatManila(item.at, "d MMM yyyy, h:mm a")].filter(Boolean).join(" · ");
}

export function ReturnBanner({ reason }: { reason: TaskComment | null }) {
  if (!reason) return null;
  return (
    <div className="rec-banner rec-stack" role="status">
      <div>
        <StatusBadge tone="warning" label="Returned" />
      </div>
      <p className="body whitespace-pre-wrap break-words">{reason.comment}</p>
      <p className="caption">{byline(reason)}</p>
    </div>
  );
}

export function TaskCommentList({ comments, level }: { comments: TaskComment[]; level: "h2" | "h3" }) {
  if (comments.length === 0) return null;
  const Heading = level;
  return (
    <section className="rec-stack">
      <Heading className={level === "h2" ? "heading" : "subheading"}>Comments</Heading>
      <ol className="rec-methods">
        {comments.map((item) => (
          <li key={item.id} className="rec-card rec-stack">
            <p className="label">{[item.stepName, item.outcomeLabel].filter(Boolean).join(" · ")}</p>
            <p className="body-sm whitespace-pre-wrap break-words">{item.comment}</p>
            <p className="caption rec-muted">{byline(item)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
