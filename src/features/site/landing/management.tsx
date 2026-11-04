import {
  BarChart3Icon,
  BookOpenIcon,
  QrCodeIcon,
  ReceiptTextIcon,
  ScrollTextIcon,
  UsersIcon,
} from "lucide-react";

import { Section, SectionHeading } from "../section";

export const MANAGEMENT_FEATURES = [
  {
    icon: BookOpenIcon,
    title: "Menu management",
    body: "Categories, items, variants and add-ons, dietary tags and prep times. Mark items unavailable the moment you run out.",
  },
  {
    icon: QrCodeIcon,
    title: "Tables & secure QR codes",
    body: "Create tables by section and capacity. Print each table's QR code, or regenerate and revoke it whenever you need to.",
  },
  {
    icon: UsersIcon,
    title: "Staff roles & permissions",
    body: "Owner, admin, manager, waiter, kitchen and cashier roles — each sees only the screens and actions their job needs.",
  },
  {
    icon: ReceiptTextIcon,
    title: "Counter billing",
    body: "Taxes, discounts and service charge calculated for you. Split or part-pay bills by cash, UPI or card, recorded at the counter.",
  },
  {
    icon: BarChart3Icon,
    title: "Analytics dashboards",
    body: "Sales and order trends for a branch or across the whole business, for the dates you choose.",
  },
  {
    icon: ScrollTextIcon,
    title: "Audit logs",
    body: "Important actions — like voids, refunds and setting changes — are recorded with who did what and when.",
  },
] as const;

export function Management() {
  return (
    <Section id="management">
      <SectionHeading
        eyebrow="Restaurant management"
        title="Everything behind the counter, in one place"
        description="Set up your menu, tables and team once — then run service, billing and reporting from the same dashboard."
      />
      <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {MANAGEMENT_FEATURES.map((f) => (
          <div
            key={f.title}
            className="flex flex-col gap-3 bg-card p-6 motion-safe:transition-colors motion-safe:hover:bg-accent/40 sm:p-7"
          >
            <f.icon aria-hidden="true" className="size-5 text-primary" />
            <h3 className="font-semibold tracking-tight">{f.title}</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
