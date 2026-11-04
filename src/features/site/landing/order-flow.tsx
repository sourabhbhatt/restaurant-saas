import {
  BellRingIcon,
  ChefHatIcon,
  HandPlatterIcon,
  ShieldCheckIcon,
  TimerIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { Section, SectionHeading } from "../section";

const STAGES = [
  { label: "Placed", hint: "Guest or staff", tone: "bg-muted text-foreground" },
  { label: "Approved", hint: "By the waiter", tone: "bg-primary text-primary-foreground" },
  { label: "Preparing", hint: "Kitchen display", tone: "bg-warning text-warning-foreground" },
  { label: "Ready", hint: "Ready to serve", tone: "bg-success text-success-foreground" },
  { label: "Served", hint: "At the table", tone: "bg-secondary text-secondary-foreground" },
];

const POINTS = [
  {
    icon: ShieldCheckIcon,
    title: "Nothing reaches the kitchen unchecked",
    body: "Every guest order waits for a waiter's approval. Mistaken orders can be rejected with a reason.",
  },
  {
    icon: ChefHatIcon,
    title: "A kitchen display built for the pass",
    body: "Approved orders appear instantly. Cooks move tickets through preparing and ready, item by item.",
  },
  {
    icon: TimerIcon,
    title: "Delayed orders stand out",
    body: "Tickets that run past their prep time are highlighted, so nothing sits forgotten at the back of the queue.",
  },
  {
    icon: BellRingIcon,
    title: "Everyone sees the same truth",
    body: "Waiters see when food is ready, guests see their order's progress, and managers see the whole floor.",
  },
];

export function OrderFlow() {
  return (
    <Section id="order-flow" tone="muted">
      <SectionHeading
        eyebrow="Waiter → kitchen"
        title="One order flow your whole team can trust"
        description="A clear path for every order, with a person in the loop before anything is cooked."
      />

      <ol
        aria-label="Order stages"
        className="mx-auto mt-14 flex max-w-4xl flex-col items-stretch gap-2 sm:flex-row sm:items-center"
      >
        {STAGES.map((s, i) => (
          <li key={s.label} className="flex flex-1 items-center gap-2 sm:flex-col sm:gap-3">
            <div className="flex w-full items-center gap-2">
              <span
                className={cn(
                  "flex h-10 flex-1 items-center justify-center rounded-full px-4 text-sm font-semibold shadow-xs",
                  s.tone,
                )}
              >
                {s.label}
              </span>
              {i < STAGES.length - 1 && (
                <span aria-hidden="true" className="hidden h-px w-4 bg-border sm:block" />
              )}
            </div>
            <span className="w-28 text-xs text-muted-foreground sm:w-auto sm:text-center">
              {s.hint}
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-14 grid gap-5 sm:grid-cols-2">
        {POINTS.map((p) => (
          <div key={p.title} className="flex gap-4 rounded-2xl border bg-card p-6 shadow-xs">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <p.icon aria-hidden="true" className="size-5" />
            </span>
            <div className="flex flex-col gap-1.5">
              <h3 className="font-semibold tracking-tight">{p.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{p.body}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <HandPlatterIcon aria-hidden="true" className="size-4" />
        Staff can also place orders for a table directly from their device.
      </p>
    </Section>
  );
}
