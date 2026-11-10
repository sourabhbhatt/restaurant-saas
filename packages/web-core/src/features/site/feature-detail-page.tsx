import Link from "next/link";
import { ArrowRightIcon, CheckIcon, CircleSlashIcon } from "lucide-react";

import { Button } from "@ros/ui/ui/button";

import { ALL_FAQ_ITEMS } from "./faq-data";
import { FaqList } from "./faq-list";
import { getFeatureDetail } from "./feature-details";
import { FinalCta } from "./landing/final-cta";
import { PageIntro, Section } from "./section";
import { getSitePage, type SitePath } from "./seo/site-pages";

/** One feature, one search intent: direct answer, how it works, details, honest limits, FAQ. */
export function FeatureDetailPage({ path }: { path: SitePath }) {
  const detail = getFeatureDetail(path);
  const faqs = ALL_FAQ_ITEMS.filter((item) => detail.faqIds.includes(item.id));

  return (
    <>
      <PageIntro
        breadcrumbs={detail.path}
        eyebrow={detail.eyebrow}
        title={detail.h1}
        description={detail.lead}
      >
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/sign-up">Start free trial</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/pricing">See pricing</Link>
          </Button>
        </div>
      </PageIntro>

      <Section className="py-14 md:py-20">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            {detail.definition.question}
          </h2>
          {detail.definition.answer.map((p) => (
            <p key={p} className="leading-relaxed text-muted-foreground">
              {p}
            </p>
          ))}
        </div>
      </Section>

      <Section tone="muted" className="py-14 md:py-20">
        <div className="flex flex-col gap-10">
          <h2 className="text-center text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            {detail.stepsTitle}
          </h2>
          <ol className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {detail.steps.map((step, i) => (
              <li key={step.title} className="flex flex-col gap-3 rounded-2xl border bg-card p-6">
                <span
                  aria-hidden="true"
                  className="text-3xl font-semibold tracking-tight text-muted-foreground/40"
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="text-lg font-semibold tracking-tight">
                  <span className="sr-only">Step {i + 1}: </span>
                  {step.title}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      <Section className="py-14 md:py-20">
        <div className="grid gap-6 md:grid-cols-2">
          {detail.details.map((group) => (
            <section
              key={group.title}
              aria-labelledby={`${slug(group.title)}-title`}
              className="flex flex-col gap-4 rounded-2xl border bg-card p-6 shadow-xs sm:p-8"
            >
              <h2
                id={`${slug(group.title)}-title`}
                className="text-xl font-semibold tracking-tight"
              >
                {group.title}
              </h2>
              <ul className="flex flex-col gap-3">
                {group.points.map((point) => (
                  <li key={point} className="flex items-start gap-3 text-sm">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                      <CheckIcon aria-hidden="true" className="size-3" />
                    </span>
                    {point}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Section>

      <Section tone="muted" className="py-14 md:py-20">
        <div className="mx-auto flex max-w-4xl flex-col gap-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              What it doesn&apos;t do yet
            </h2>
            <p className="text-muted-foreground">Better to know now than after you sign up.</p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {detail.limits.map((limit) => (
              <li
                key={limit.title}
                className="flex flex-col gap-1.5 rounded-2xl border border-dashed bg-background p-5"
              >
                <h3 className="flex items-center gap-2 font-semibold">
                  <CircleSlashIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                  {limit.title}
                </h3>
                <p className="text-sm text-muted-foreground">{limit.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {faqs.length > 0 && (
        <Section className="py-14 md:py-20">
          <div className="mx-auto flex max-w-3xl flex-col gap-6">
            <h2 className="text-center text-2xl font-semibold tracking-tight">Common questions</h2>
            <FaqList items={faqs} />
          </div>
        </Section>
      )}

      <Section tone="muted" className="py-12 md:py-16">
        <nav aria-labelledby="related-title" className="mx-auto flex max-w-4xl flex-col gap-5">
          <h2 id="related-title" className="text-center text-xl font-semibold tracking-tight">
            Related
          </h2>
          <ul className="grid gap-3 sm:grid-cols-3">
            {detail.related.map((relatedPath) => {
              const page = getSitePage(relatedPath);
              return (
                <li key={relatedPath}>
                  <Link
                    href={relatedPath}
                    className="group flex h-full items-center justify-between gap-3 rounded-xl border bg-background px-4 py-3 text-sm font-medium hover:border-primary/40"
                  >
                    {page.label}
                    <ArrowRightIcon
                      aria-hidden="true"
                      className="size-4 text-muted-foreground motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </Section>

      <div className="pt-16 md:pt-20">
        <FinalCta />
      </div>
    </>
  );
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
