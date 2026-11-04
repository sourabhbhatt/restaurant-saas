import Link from "next/link";
import type { ReactNode } from "react";
import { TriangleAlertIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { BRAND, LEGAL_NAV } from "../brand";

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

/**
 * Shared layout for legal pages. The content is a TEMPLATE: the banner stays
 * until a lawyer has reviewed the text and the [bracketed] placeholders are filled.
 */
export function LegalDocument({
  title,
  summary,
  sections,
  currentHref,
}: {
  title: string;
  summary: ReactNode;
  sections: LegalSection[];
  currentHref: string;
}) {
  return (
    <div className="px-4 py-12 sm:px-6 md:py-16">
      <div className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-[14rem_1fr]">
        <aside className="flex flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
          <nav aria-label="Legal documents" className="flex flex-wrap gap-2 lg:flex-col lg:gap-1">
            {LEGAL_NAV.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={l.href === currentHref ? "page" : undefined}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground lg:border-0",
                  l.href === currentHref && "bg-accent font-medium text-foreground",
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <nav aria-label="On this page" className="hidden lg:block">
            <p className="mb-2 px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              On this page
            </p>
            <ol className="flex flex-col gap-0.5 text-sm">
              {sections.map((s, i) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="block rounded-md px-3 py-1 text-muted-foreground hover:text-foreground"
                  >
                    {i + 1}. {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <article className="flex max-w-3xl min-w-0 flex-col gap-8">
          <header className="flex flex-col gap-4">
            <div
              role="note"
              className="flex items-start gap-3 rounded-xl border border-warning/50 bg-warning/10 p-4 text-sm"
            >
              <TriangleAlertIcon
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-warning-foreground dark:text-warning"
              />
              <p>
                <strong>Template — review with a lawyer before launch.</strong> This document is a
                starting point for an Indian SaaS business and is not legal advice. Replace every
                [bracketed] placeholder and have it reviewed before relying on it.
              </p>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
            <p className="text-sm text-muted-foreground">
              {BRAND.name} · Operated by {BRAND.legalEntity} · Effective date: [DD Month YYYY]
            </p>
            <div className="text-base leading-relaxed text-muted-foreground">{summary}</div>
          </header>

          {sections.map((s, i) => (
            <section
              key={s.id}
              id={s.id}
              aria-labelledby={`${s.id}-title`}
              className="flex scroll-mt-24 flex-col gap-3 border-t pt-8"
            >
              <h2 id={`${s.id}-title`} className="text-xl font-semibold tracking-tight">
                {i + 1}. {s.title}
              </h2>
              <div className="flex flex-col gap-3 text-[0.95rem] leading-relaxed text-foreground/85 [&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_li]:pl-1 [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-5">
                {s.body}
              </div>
            </section>
          ))}

          <footer className="border-t pt-8 text-sm text-muted-foreground">
            Questions about this document? Email{" "}
            <a
              href={`mailto:${BRAND.supportEmail}`}
              className="font-medium text-foreground underline underline-offset-4"
            >
              {BRAND.supportEmail}
            </a>
            .
          </footer>
        </article>
      </div>
    </div>
  );
}
