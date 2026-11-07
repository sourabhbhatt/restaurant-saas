import { Building2Icon, CheckIcon, MapPinIcon, StoreIcon } from "lucide-react";

import { cn } from "@ros/ui/utils";

import { Section, SectionHeading } from "../section";

const POINTS = [
  "One workspace for every restaurant you own",
  "Branch-level prices and item availability on a shared menu",
  "Staff assigned to a whole restaurant or a single branch",
  "Branch comparison reports on plans that include them",
];

export function MultiBranch() {
  return (
    <Section id="multi-branch" tone="muted">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div className="flex flex-col gap-8">
          <SectionHeading
            align="left"
            eyebrow="Multi-branch"
            title="Grow from one outlet to many without changing tools"
            description="Run multiple restaurants and branches from a single account, with the control to keep each location's details right."
          />
          <ul className="flex flex-col gap-3">
            {POINTS.map((p) => (
              <li key={p} className="flex items-start gap-3 text-sm">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                  <CheckIcon aria-hidden="true" className="size-3" />
                </span>
                {p}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Number of restaurants and branches depends on your plan.
          </p>
        </div>
        <BranchTree />
      </div>
    </Section>
  );
}

function BranchTree() {
  return (
    <div aria-hidden="true" className="relative rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
      <Node icon={Building2Icon} title="Your workspace" meta="Owner · 2 restaurants" primary />
      <div className="mt-4 ml-5 flex flex-col gap-4 border-l border-dashed pl-6">
        <div className="flex flex-col gap-3">
          <Node icon={StoreIcon} title="Spice Route" meta="Shared menu · 48 items" />
          <div className="ml-5 flex flex-col gap-2 border-l border-dashed pl-6">
            <Node icon={MapPinIcon} title="Indiranagar" meta="Paneer tikka ₹280" small />
            <Node
              icon={MapPinIcon}
              title="Koramangala"
              meta="Paneer tikka ₹300 · branch price"
              small
              accent
            />
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <Node icon={StoreIcon} title="Dosa Corner" meta="Shared menu · 31 items" />
          <div className="ml-5 flex flex-col gap-2 border-l border-dashed pl-6">
            <Node
              icon={MapPinIcon}
              title="HSR Layout"
              meta="Filter coffee · sold out"
              small
              muted
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Node({
  icon: Icon,
  title,
  meta,
  primary,
  small,
  accent,
  muted,
}: {
  icon: typeof StoreIcon;
  title: string;
  meta: string;
  primary?: boolean;
  small?: boolean;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border bg-background p-3",
        primary && "border-primary/30 bg-primary/5",
        small && "p-2.5",
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground",
          primary && "bg-primary text-primary-foreground",
          small && "size-7",
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-col">
        <p className={cn("truncate text-sm font-medium", small && "text-xs")}>{title}</p>
        <p
          className={cn(
            "truncate text-xs text-muted-foreground",
            accent && "text-primary",
            muted && "line-through",
          )}
        >
          {meta}
        </p>
      </div>
    </div>
  );
}
