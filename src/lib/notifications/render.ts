/** Replaces `{{name}}` placeholders. Missing names become an empty string. */
export function applyVariables(source: string, variables: Record<string, string | null | undefined>): string {
  return source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name: string) => variables[name] ?? "");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** A small Markdown subset: paragraphs, bold, and links. */
export function markdownToText(source: string): string {
  return source
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function markdownToHtml(source: string): string {
  const blocks = source
    .trim()
    .split(/\n{2,}/)
    .map((block) => inlineHtml(block.trim()))
    .filter(Boolean);
  return blocks.map((block) => `<p>${block}</p>`).join("");
}

function inlineHtml(block: string): string {
  const links: string[] = [];
  const withLinks = block.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, href: string) => {
    const safeHref = href.trim();
    if (!/^https?:\/\//i.test(safeHref) && !safeHref.startsWith("/")) {
      links.push(escapeHtml(label));
      return `@@${links.length - 1}@@`;
    }
    links.push(`<a href="${escapeHtml(safeHref)}">${escapeHtml(label)}</a>`);
    return `@@${links.length - 1}@@`;
  });
  const escaped = escapeHtml(withLinks).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  const linked = escaped.replace(/@@(\d+)@@/g, (_, index: string) => links[Number(index)] ?? "");
  return linked.replaceAll("\n", "<br>");
}

export function firstLink(source: string): string | null {
  const match = source.match(/\[[^\]]+\]\(([^)]+)\)/);
  return match?.[1]?.trim() || null;
}

export function paragraphsOf(source: string): string[] {
  return markdownToText(source)
    .split(/\n{2,}/)
    .map((part) => part.replaceAll("\n", " ").trim())
    .filter(Boolean);
}
