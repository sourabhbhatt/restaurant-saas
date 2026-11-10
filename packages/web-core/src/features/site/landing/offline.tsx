import Link from "next/link";
import { CheckIcon, WifiIcon, WifiOffIcon } from "lucide-react";

import { Section, SectionHeading } from "../section";

const OFFLINE_OK = [
  "Install on any phone, tablet or computer as an app (PWA)",
  "Menus and screens you've already opened keep working",
  "Waiters can keep taking orders; the kitchen can keep updating tickets",
  "Queued changes sync automatically, in order, when you're back online",
];

const NEEDS_CONNECTION = [
  "Guest QR orders and approvals",
  "Generating a bill",
  "Confirming a payment",
];

export function OfflineSection() {
  return (
    <Section id="offline">
      <SectionHeading
        eyebrow="Offline-ready"
        title="Built for patchy restaurant Wi-Fi"
        description="Staff devices keep going when the connection drops — and we're upfront about the steps that still need the internet."
      />
      <div className="mx-auto mt-14 grid max-w-4xl gap-5 md:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-5 rounded-2xl border bg-card p-6 shadow-xs sm:p-7">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-success/15 text-success">
              <WifiOffIcon aria-hidden="true" className="size-5" />
            </span>
            <h3 className="font-semibold tracking-tight">Keeps working offline</h3>
          </div>
          <ul className="flex flex-col gap-3">
            {OFFLINE_OK.map((p) => (
              <li key={p} className="flex items-start gap-3 text-sm">
                <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-5 rounded-2xl border border-warning/50 bg-warning/10 p-6 sm:p-7">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-warning/30 text-warning-foreground dark:text-warning">
              <WifiIcon aria-hidden="true" className="size-5" />
            </span>
            <h3 className="font-semibold tracking-tight">Needs a connection</h3>
          </div>
          <ul className="flex flex-col gap-2 text-sm font-medium">
            {NEEDS_CONNECTION.map((p) => (
              <li
                key={p}
                className="rounded-lg border border-warning/40 bg-background/70 px-3 py-2"
              >
                {p}
              </li>
            ))}
          </ul>
          <p className="text-sm text-foreground/80">
            These steps must reach the server so the kitchen, waiters and the bill always agree.{" "}
            <Link
              href="/features/offline-mode"
              className="font-medium text-foreground underline underline-offset-4"
            >
              How offline mode works
            </Link>
          </p>
        </div>
      </div>
    </Section>
  );
}
