import Link from "next/link";

import { BRAND } from "./brand";
import { ALL_FAQ_ITEMS } from "./faq-data";
import { FaqList } from "./faq-list";
import { PricingPlans } from "./pricing/pricing-plans";
import { PageIntro, Section } from "./section";

const PRICING_FAQ_IDS = ["trial", "after-expiry", "online-payments", "multi-branch"];

export function PricingPage() {
  return (
    <>
      <PageIntro
        eyebrow="Pricing"
        title="Plans for one outlet or a whole group"
        description="Every plan includes QR ordering with waiter approval. Start free, then choose the plan that fits."
      />
      <Section className="py-14 md:py-20">
        <PricingPlans variant="full" />
        <p className="mt-10 text-center text-sm text-muted-foreground">
          Subscriptions are activated by our team — we&apos;ll confirm the plan and payment details with
          you directly. Read our{" "}
          <Link href="/legal/refunds" className="font-medium text-foreground underline underline-offset-4">
            cancellation &amp; refund policy
          </Link>
          . Need something bigger?{" "}
          <Link href="/contact" className="font-medium text-foreground underline underline-offset-4">
            Contact {BRAND.name}
          </Link>
          .
        </p>
      </Section>
      <Section tone="muted" className="py-14 md:py-20">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <h2 className="text-center text-2xl font-semibold tracking-tight">Pricing questions</h2>
          <FaqList items={ALL_FAQ_ITEMS.filter((i) => PRICING_FAQ_IDS.includes(i.id))} />
        </div>
      </Section>
    </>
  );
}
