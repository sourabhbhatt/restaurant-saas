import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

import { Button } from "@ros/ui/ui/button";

import { PricingPlans } from "../pricing/pricing-plans";
import { Section, SectionHeading } from "../section";

export function PricingTeaser() {
  return (
    <Section id="pricing" tone="muted">
      <SectionHeading
        eyebrow="Pricing"
        title="Simple plans that grow with you"
        description="Start with a free trial. Pick a plan when you're ready."
      />
      <div className="mt-12">
        <PricingPlans variant="teaser" />
      </div>
      <div className="mt-10 flex justify-center">
        <Button asChild variant="outline">
          <Link href="/pricing">
            Compare all plans
            <ArrowRightIcon aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </Section>
  );
}
