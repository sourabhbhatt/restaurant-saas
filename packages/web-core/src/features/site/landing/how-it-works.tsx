import { ScanLineIcon, SmartphoneIcon, UserCheckIcon } from "lucide-react";

import { Section, SectionHeading } from "../section";

const STEPS = [
  {
    icon: ScanLineIcon,
    title: "Scan the table's QR code",
    body: "Each table has its own secure QR code. Guests point their camera at it — nothing to download, no account to create.",
  },
  {
    icon: SmartphoneIcon,
    title: "Browse and order together",
    body: "Your live menu opens with photos, variants and add-ons. Everyone at the table can add to the order from their own phone.",
  },
  {
    icon: UserCheckIcon,
    title: "Waiter approves, kitchen cooks",
    body: "The order lands with the waiter first. Once approved it appears on the kitchen display — and guests can follow its status.",
  },
];

export function HowItWorks() {
  return (
    <Section id="how-it-works">
      <SectionHeading
        eyebrow="QR ordering"
        title="From scan to kitchen in three steps"
        description="Guests order at their own pace. Your staff stay in charge of what actually gets cooked."
      />
      <ol className="mt-14 grid gap-5 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <li
            key={step.title}
            className="group relative flex flex-col gap-4 rounded-2xl border bg-card p-6 shadow-xs motion-safe:transition-shadow motion-safe:hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <step.icon aria-hidden="true" className="size-5" />
              </span>
              <span
                aria-hidden="true"
                className="text-4xl font-semibold tracking-tight text-muted-foreground/25"
              >
                {String(i + 1).padStart(2, "0")}
              </span>
            </div>
            <h3 className="text-lg font-semibold tracking-tight">
              <span className="sr-only">Step {i + 1}: </span>
              {step.title}
            </h3>
            <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
