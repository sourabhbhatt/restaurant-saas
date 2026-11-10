import {
  BellRingIcon,
  CheckIcon,
  ChefHatIcon,
  ClockIcon,
  PlusIcon,
  ShoppingBagIcon,
  TimerIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@ros/ui/utils";

/**
 * Hero illustration of the product, built entirely from HTML/CSS (no images),
 * so it is crisp at any size, themable and costs no extra requests.
 * Purely decorative: the content is described once for screen readers.
 */
export function ProductMockup() {
  return (
    <div className="relative mx-auto w-full max-w-5xl">
      <p className="sr-only">
        Illustration: a guest orders from their phone, the waiter approves the order, and it appears
        on the kitchen display.
      </p>
      <div aria-hidden="true" className="relative select-none">
        {/* Glow */}
        <div className="absolute -inset-x-10 -top-10 -bottom-16 -z-10 rounded-[3rem] bg-[radial-gradient(50%_50%_at_50%_50%,color-mix(in_oklch,var(--primary)_22%,transparent),transparent_75%)] blur-2xl" />

        <DashboardWindow />

        <div className="absolute -bottom-10 left-2 w-[42%] max-w-[15rem] motion-safe:animate-in motion-safe:delay-300 motion-safe:duration-700 motion-safe:fill-mode-both motion-safe:fade-in motion-safe:slide-in-from-bottom-6 sm:-bottom-12 sm:-left-4 md:-left-10 md:w-[30%]">
          <PhoneMockup />
        </div>
      </div>
    </div>
  );
}

function DashboardWindow() {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-2xl ring-1 shadow-foreground/10 ring-foreground/5 motion-safe:animate-in motion-safe:duration-700 motion-safe:fill-mode-both motion-safe:zoom-in-95 motion-safe:fade-in">
      {/* Window chrome */}
      <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-destructive/60" />
        <span className="size-2.5 rounded-full bg-warning/80" />
        <span className="size-2.5 rounded-full bg-success/60" />
        <div className="mx-auto hidden h-5 w-56 rounded-md bg-background/80 sm:block" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.35fr]">
        {/* Waiter approvals */}
        <div className="flex flex-col gap-3 border-b p-4 sm:border-r sm:border-b-0 sm:p-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">Waiter · Approvals</p>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
              <BellRingIcon className="size-3" /> 2 new
            </span>
          </div>
          <ApprovalCard
            table="T4"
            guests="2 guests"
            items={["Paneer tikka", "Butter naan ×2"]}
            highlight
          />
          <ApprovalCard table="T9" guests="1 guest" items={["Masala dosa", "Filter coffee"]} />
        </div>

        {/* Kitchen display */}
        <div className="flex flex-col gap-3 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold">
              <ChefHatIcon className="size-3.5" /> Kitchen display
            </p>
            <p className="text-[10px] text-muted-foreground">Main kitchen</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <KitchenColumn title="New" tone="info">
              <Ticket table="T2" items={["Veg biryani", "Raita"]} time="2m" />
            </KitchenColumn>
            <KitchenColumn title="Preparing" tone="warning">
              <Ticket table="T7" items={["Chole bhature"]} time="14m" delayed />
              <Ticket table="T1" items={["Thali ×2"]} time="6m" />
            </KitchenColumn>
            <KitchenColumn title="Ready" tone="success">
              <Ticket table="T5" items={["Gulab jamun"]} time="1m" ready />
            </KitchenColumn>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApprovalCard({
  table,
  guests,
  items,
  highlight,
}: {
  table: string;
  guests: string;
  items: string[];
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border bg-background p-3",
        highlight && "border-primary/40 shadow-sm ring-2 ring-primary/10",
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold">
          Table {table} <span className="font-normal text-muted-foreground">· {guests}</span>
        </p>
        <span className="rounded-full bg-warning/20 px-1.5 py-0.5 text-[9px] font-medium text-warning-foreground dark:text-warning">
          Pending
        </span>
      </div>
      <ul className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
      <div className="flex gap-1.5">
        <span className="inline-flex h-6 flex-1 items-center justify-center gap-1 rounded-md bg-primary text-[10px] font-medium text-primary-foreground">
          <CheckIcon className="size-3" /> Approve
        </span>
        <span className="inline-flex h-6 items-center justify-center rounded-md border px-2 text-[10px] text-muted-foreground">
          <XIcon className="size-3" />
        </span>
      </div>
    </div>
  );
}

const toneDot = {
  info: "bg-info",
  warning: "bg-warning",
  success: "bg-success",
} as const;

function KitchenColumn({
  title,
  tone,
  children,
}: {
  title: string;
  tone: keyof typeof toneDot;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-xl bg-muted/60 p-2">
      <p className="flex items-center gap-1.5 px-1 text-[10px] font-medium text-muted-foreground">
        <span className={cn("size-1.5 rounded-full", toneDot[tone])} />
        {title}
      </p>
      {children}
    </div>
  );
}

function Ticket({
  table,
  items,
  time,
  delayed,
  ready,
}: {
  table: string;
  items: string[];
  time: string;
  delayed?: boolean;
  ready?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-lg border bg-card p-2 shadow-xs",
        delayed && "border-destructive/50 bg-destructive/5",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <p className="text-[11px] font-semibold">{table}</p>
        <span
          className={cn(
            "inline-flex items-center gap-0.5 text-[9px] text-muted-foreground",
            delayed && "font-semibold text-destructive",
          )}
        >
          {delayed ? <TimerIcon className="size-2.5" /> : <ClockIcon className="size-2.5" />}
          {time}
        </span>
      </div>
      <ul className="flex flex-col text-[10px] leading-tight text-muted-foreground">
        {items.map((i) => (
          <li key={i} className="truncate">
            {i}
          </li>
        ))}
      </ul>
      {delayed && (
        <span className="w-fit rounded bg-destructive px-1 text-[8px] font-semibold tracking-wide text-destructive-foreground uppercase">
          Delayed
        </span>
      )}
      {ready && (
        <span className="w-fit rounded bg-success/10 px-1 text-[8px] font-semibold tracking-wide text-success uppercase">
          Ready to serve
        </span>
      )}
    </div>
  );
}

function PhoneMockup() {
  return (
    <div className="rounded-[1.75rem] border-[5px] border-foreground/85 bg-card p-1 shadow-2xl shadow-foreground/20 dark:border-foreground/25">
      <div className="flex flex-col gap-2 overflow-hidden rounded-[1.35rem] bg-background p-2.5">
        <div className="mx-auto h-1 w-10 rounded-full bg-foreground/15" />
        <div className="flex items-center gap-2">
          <span className="size-6 rounded-lg bg-primary/15" />
          <div className="flex flex-col">
            <p className="text-[10px] leading-tight font-semibold">Spice Route</p>
            <p className="text-[8px] leading-tight text-muted-foreground">Table 4 · Indiranagar</p>
          </div>
        </div>
        <div className="flex gap-1">
          {["Starters", "Mains", "Breads"].map((c, i) => (
            <span
              key={c}
              className={cn(
                "rounded-full border px-1.5 py-0.5 text-[8px]",
                i === 0
                  ? "border-primary bg-primary text-primary-foreground"
                  : "text-muted-foreground",
              )}
            >
              {c}
            </span>
          ))}
        </div>
        {[
          { name: "Paneer tikka", price: "₹280", added: true },
          { name: "Hara bhara kebab", price: "₹220", added: false },
          { name: "Butter naan", price: "₹60", added: true },
        ].map((item) => (
          <div key={item.name} className="flex items-center gap-2 rounded-lg border p-1.5">
            <span className="size-7 shrink-0 rounded-md bg-gradient-to-br from-primary/25 to-chart-4/30" />
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="truncate text-[9px] font-medium">{item.name}</p>
              <p className="text-[8px] text-muted-foreground">{item.price}</p>
            </div>
            <span
              className={cn(
                "inline-flex size-4 items-center justify-center rounded-md",
                item.added ? "bg-success text-success-foreground" : "border text-muted-foreground",
              )}
            >
              {item.added ? <CheckIcon className="size-2.5" /> : <PlusIcon className="size-2.5" />}
            </span>
          </div>
        ))}
        <div className="flex items-center justify-between rounded-lg bg-primary px-2 py-1.5 text-primary-foreground">
          <span className="inline-flex items-center gap-1 text-[9px] font-medium">
            <ShoppingBagIcon className="size-3" /> 3 items
          </span>
          <span className="text-[9px] font-semibold">Place order</span>
        </div>
      </div>
    </div>
  );
}
