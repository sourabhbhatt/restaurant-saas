import Link from "next/link";

import { Button } from "@/components/ui/button";

import { BRAND } from "./brand";
import { FAQ_GROUPS } from "./faq-data";
import { FaqList } from "./faq-list";
import { PageIntro, Section } from "./section";

export function FaqPage() {
  return (
    <>
      <PageIntro
        eyebrow="FAQ"
        title="Frequently asked questions"
        description={`Honest answers about how ${BRAND.name} works — and what it doesn't do yet.`}
      />
      <Section className="py-14 md:py-20">
        <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[12rem_1fr]">
          <nav aria-label="FAQ topics" className="hidden lg:block">
            <ul className="sticky top-24 flex flex-col gap-1 text-sm">
              {FAQ_GROUPS.map((g) => (
                <li key={g.id}>
                  <a
                    href={`#${g.id}`}
                    className="block rounded-md px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    {g.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex flex-col gap-12">
            {FAQ_GROUPS.map((g) => (
              <section
                key={g.id}
                id={g.id}
                aria-labelledby={`${g.id}-title`}
                className="flex scroll-mt-24 flex-col gap-4"
              >
                <h2 id={`${g.id}-title`} className="text-xl font-semibold tracking-tight">
                  {g.title}
                </h2>
                <FaqList items={g.items} />
              </section>
            ))}
            <div className="flex flex-col items-start gap-3 rounded-2xl border bg-muted/40 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold">Still have a question?</h2>
                <p className="text-sm text-muted-foreground">
                  Email us and we&apos;ll get back to you.
                </p>
              </div>
              <Button asChild variant="outline">
                <Link href="/contact">Contact us</Link>
              </Button>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
