import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

import { Button } from "@ros/ui/ui/button";

import { BRAND } from "../brand";
import { ALL_FAQ_ITEMS, FAQ_PREVIEW_IDS } from "../faq-data";
import { FaqList } from "../faq-list";
import { Section, SectionHeading } from "../section";

export function FaqPreview() {
  const items = ALL_FAQ_ITEMS.filter((i) => FAQ_PREVIEW_IDS.includes(i.id));
  return (
    <Section id="faq">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
        <div className="flex flex-col gap-6">
          <SectionHeading
            align="left"
            eyebrow="FAQ"
            title="Straight answers"
            description={`Including what ${BRAND.name} doesn't do yet.`}
          />
          <Button asChild variant="outline" className="w-fit">
            <Link href="/faq">
              Read all questions
              <ArrowRightIcon aria-hidden="true" />
            </Link>
          </Button>
        </div>
        <FaqList items={items} />
      </div>
    </Section>
  );
}
