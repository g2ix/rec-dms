import { describe, expect, it } from "vitest";
import { applyVariables, markdownToHtml, markdownToText } from "@/lib/notifications/render";

describe("notification copy", () => {
  it("fills placeholders and leaves unknown ones blank", () => {
    expect(applyVariables("Hello {{recipientName}} {{missing}}", { recipientName: "Ana" })).toBe("Hello Ana ");
  });

  it("renders bold and links as text and as HTML", () => {
    const source = "See **the task**.\n\n[Open the task](https://rec.example.edu/app/tasks)";
    expect(markdownToText(source)).toContain("the task");
    expect(markdownToText(source)).toContain("https://rec.example.edu/app/tasks");
    const html = markdownToHtml(source);
    expect(html).toContain("<strong>the task</strong>");
    expect(html).toContain('href="https://rec.example.edu/app/tasks"');
    expect(html).not.toContain("<script");
  });
});
