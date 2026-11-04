import Link from "next/link";
import {
  BarChart3Icon,
  BookOpenIcon,
  Building2Icon,
  CheckIcon,
  ChefHatIcon,
  ClockIcon,
  QrCodeIcon,
  ReceiptTextIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  UsersIcon,
  WifiOffIcon,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";

import { FinalCta } from "./landing/final-cta";
import { NOT_YET } from "./not-yet";
import { PageIntro, Section } from "./section";

interface FeatureBlock {
  id: string;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  note?: string;
}

const BLOCKS: FeatureBlock[] = [
  {
    id: "qr-ordering",
    icon: QrCodeIcon,
    eyebrow: "Guests",
    title: "QR table ordering — no app, no account",
    body: "Guests scan the code on their table and order from your live menu in the browser. Several guests can order at the same table, each from their own phone.",
    points: [
      "Menu shows only items available at that branch, at that branch's prices",
      "Variants and add-ons, dietary information and allergens",
      "Guests can follow the status of their orders and ask for the bill",
    ],
  },
  {
    id: "waiter",
    icon: ShieldCheckIcon,
    eyebrow: "Waiters",
    title: "Every order approved by a person",
    body: "Guest orders arrive at the waiter first. Nothing reaches the kitchen until a waiter accepts it — mistaken orders are rejected with a reason.",
    points: [
      "Live queue of orders waiting for approval",
      "Staff can also place orders for a table",
      "See which tables are active, which orders are ready and who asked for the bill",
    ],
  },
  {
    id: "kitchen",
    icon: ChefHatIcon,
    eyebrow: "Kitchen",
    title: "A kitchen display that keeps the pass moving",
    body: "Approved orders appear on the kitchen display straight away. Cooks move tickets through preparing and ready, down to individual items.",
    points: [
      "Prep status per order and per item",
      "Delayed orders highlighted when they run past their prep time",
      "Priority flags for rush orders",
    ],
  },
  {
    id: "billing",
    icon: ReceiptTextIcon,
    eyebrow: "Cashier",
    title: "Counter billing with taxes, discounts and split payments",
    body: "Generate a bill for a table in seconds. Taxes and service charge come from branch settings; discounts are applied at billing time.",
    points: [
      "Split and partial payments",
      "Cash, UPI and card payments recorded at the counter",
      "Refunds and voids with a reason, kept in the audit log",
    ],
    note: "There is no online payment gateway yet — payments are taken on your existing methods and recorded here.",
  },
  {
    id: "menu",
    icon: BookOpenIcon,
    eyebrow: "Menu",
    title: "Menu management built for real kitchens",
    body: "Organise categories and items with photos, variants (sizes, portions) and add-on groups. Set prep times and dietary tags once.",
    points: [
      "Branch-specific prices and availability",
      "Mark items sold out instantly",
      "Featured items and discounted prices",
    ],
  },
  {
    id: "tables",
    icon: QrCodeIcon,
    eyebrow: "Tables",
    title: "Tables and secure QR codes",
    body: "Create tables with sections and capacity. Each table gets a secure QR code you can print, regenerate or revoke at any time.",
    points: [
      "Regenerating a code instantly retires the old one",
      "Revoke a table's code when it's out of service",
      "Table status at a glance during service",
    ],
  },
  {
    id: "staff",
    icon: UsersIcon,
    eyebrow: "Team",
    title: "Staff roles and permissions",
    body: "Give each person exactly the access their job needs, for a whole restaurant or a single branch.",
    points: [
      "Owner, admin, manager, waiter, kitchen and cashier roles",
      "Invite staff by email",
      "Permissions enforced on the server, not just hidden in the UI",
    ],
  },
  {
    id: "multi-branch",
    icon: Building2Icon,
    eyebrow: "Growth",
    title: "Multiple restaurants and branches",
    body: "A single workspace holds all your restaurants; each restaurant can have many branches with their own settings, tables and staff.",
    points: [
      "Shared menus with branch-level overrides",
      "Branch-specific taxes, service charge and payment methods",
      "Switch between branches without signing out",
    ],
    note: "The number of restaurants, branches, staff and tables depends on your plan.",
  },
  {
    id: "offline",
    icon: WifiOffIcon,
    eyebrow: "Reliability",
    title: "Offline-ready staff devices",
    body: "Install the app on any device. Screens and menus you've loaded keep working offline, drafts and carts are saved locally, and changes sync when you reconnect.",
    points: [
      "Installable web app (PWA) — no app store needed",
      "Carts and drafts survive a dropped connection",
      "Automatic sync when you're back online",
    ],
    note: "Placing orders and confirming payments require a connection, so they wait until you're back online.",
  },
  {
    id: "analytics",
    icon: BarChart3Icon,
    eyebrow: "Insight",
    title: "Analytics dashboards",
    body: "Follow sales and orders for a branch or across the business, for any date range.",
    points: [
      "Per-branch and whole-business views",
      "Branch comparison and advanced reports on plans that include them",
    ],
  },
  {
    id: "audit",
    icon: ScrollTextIcon,
    eyebrow: "Accountability",
    title: "Audit logs",
    body: "Important actions are recorded with who did it and when — from approvals and voids to setting changes.",
    points: [
      "Activity history for owners and admins",
      "No passwords or payment secrets ever logged",
    ],
  },
];

export function FeaturesPage() {
  return (
    <>
      <PageIntro
        eyebrow="Features"
        title="Everything a dine-in restaurant needs to run service"
        description="From the guest's first scan to the final bill — with your staff in control at every step."
      >
        <nav
          aria-label="Features on this page"
          className="flex max-w-3xl flex-wrap justify-center gap-2"
        >
          {BLOCKS.map((b) => (
            <Link
              key={b.id}
              href={`#${b.id}`}
              className="rounded-full border bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {b.eyebrow}
            </Link>
          ))}
        </nav>
      </PageIntro>

      <Section className="py-16 md:py-20">
        <div className="flex flex-col gap-6">
          {BLOCKS.map((b) => (
            <article
              key={b.id}
              id={b.id}
              aria-labelledby={`${b.id}-title`}
              className="grid scroll-mt-24 gap-6 rounded-2xl border bg-card p-6 shadow-xs sm:p-8 md:grid-cols-[1.1fr_1fr] md:gap-10"
            >
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <b.icon aria-hidden="true" className="size-5" />
                  </span>
                  <span className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">
                    {b.eyebrow}
                  </span>
                </div>
                <h2
                  id={`${b.id}-title`}
                  className="text-2xl font-semibold tracking-tight text-balance"
                >
                  {b.title}
                </h2>
                <p className="leading-relaxed text-muted-foreground">{b.body}</p>
                {b.note && (
                  <p className="flex items-start gap-2 rounded-lg border border-info/25 bg-info/5 px-3 py-2 text-sm text-foreground/85">
                    <ClockIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info" />
                    {b.note}
                  </p>
                )}
              </div>
              <ul className="flex flex-col gap-3 self-center">
                {b.points.map((p) => (
                  <li key={p} className="flex items-start gap-3 text-sm">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                      <CheckIcon aria-hidden="true" className="size-3" />
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </Section>

      <Section tone="muted" className="py-16 md:py-20">
        <div className="flex flex-col items-center gap-8">
          <div className="flex max-w-2xl flex-col items-center gap-3 text-center">
            <h2 className="text-3xl font-semibold tracking-tight">Not available yet</h2>
            <p className="text-muted-foreground">
              We&apos;d rather tell you now than after you sign up.
            </p>
          </div>
          <ul className="grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {NOT_YET.map((n) => (
              <li
                key={n.title}
                className="flex flex-col gap-1.5 rounded-2xl border border-dashed bg-background p-5"
              >
                <h3 className="font-semibold">{n.title}</h3>
                <p className="text-sm text-muted-foreground">{n.body}</p>
              </li>
            ))}
          </ul>
          <Button asChild variant="outline">
            <Link href="/faq">Read the FAQ</Link>
          </Button>
        </div>
      </Section>

      <div className="pt-16 md:pt-20">
        <FinalCta />
      </div>
    </>
  );
}
