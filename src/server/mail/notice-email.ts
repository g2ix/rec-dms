import { createElement, type ReactElement } from "react";
import { Body, Container, Head, Heading, Hr, Html, Link, Text } from "@react-email/components";

export function NoticeEmail({
  heading,
  paragraphs,
  actionHref,
}: {
  heading: string;
  paragraphs: string[];
  actionHref: string | null;
}): ReactElement {
  return createElement(
    Html,
    null,
    createElement(Head, null),
    createElement(
      Body,
      null,
      createElement(
        Container,
        null,
        createElement(Heading, { as: "h1" }, heading),
        ...paragraphs.map((paragraph) => createElement(Text, { key: paragraph }, paragraph)),
        actionHref ? createElement(Link, { href: actionHref }, "Open in REC-DMS") : null,
        createElement(Hr, null),
        createElement(Text, null, "USC Research Ethics Committee"),
      ),
    ),
  );
}
