import { Fragment, type ReactNode } from "react";

const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/g;

/** Render plain text with http(s) URLs turned into links. No HTML is interpreted. */
export function Linkify({ text }: { text: string }): ReactNode {
  const parts = text.split(URL_RE);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <a
        key={i}
        href={part}
        className="font-medium break-all text-primary underline underline-offset-4"
        target="_blank"
        rel="noreferrer"
      >
        {part}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
