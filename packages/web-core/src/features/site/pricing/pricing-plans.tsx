"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckIcon, MinusIcon, SparklesIcon, TagIcon } from "lucide-react";

import { EmptyState, ErrorState } from "@ros/ui/shared/feedback";
import { Badge } from "@ros/ui/ui/badge";
import { Button } from "@ros/ui/ui/button";
import { Skeleton } from "@ros/ui/ui/skeleton";
import { ADVERTISED_FEATURES, FEATURES, LIMIT_KEYS } from "@ros/domain/subscriptions/entitlements";
import { cn } from "@ros/ui/utils";

import { BillingToggle } from "./billing-toggle";
import {
  annualSavingPercent,
  formatLimit,
  LIMIT_LABELS,
  planPrice,
  type BillingView,
  type PublicPlan,
  type PublicPlans,
} from "./plan-model";
import { usePublicPlans } from "./plans";

/**
 * Live plan cards (and, on the full pricing page, a comparison table) rendered
 * from GET /api/v1/public/plans. Loading, empty and error states included.
 * `initial` comes from the server render so the plans are in the HTML.
 */
export function PricingPlans({
  variant = "full",
  initial,
}: {
  variant?: "full" | "teaser";
  initial?: { data: PublicPlans; fetchedAt: number };
}) {
  const query = usePublicPlans(initial);
  const [view, setView] = useState<BillingView>("monthly");

  if (query.isPending) return <PlansSkeleton />;

  if (query.isError) {
    return (
      <ErrorState
        title="Pricing couldn't be loaded"
        message="We couldn't reach the pricing service. Check your connection and try again."
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
        className="mx-auto max-w-xl bg-background"
      />
    );
  }

  const { plans, trialDays } = query.data;
  if (plans.length === 0) {
    return (
      <EmptyState
        icon={<TagIcon />}
        title="Plans are being finalised"
        description="Public pricing isn't published yet. You can still start a free trial or ask us for a quote."
        action={
          <>
            <Button asChild>
              <Link href="/sign-up">Start free trial</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/contact">Contact us</Link>
            </Button>
          </>
        }
        className="mx-auto max-w-xl bg-background"
      />
    );
  }

  const bestSaving = plans.reduce<number | null>((best, p) => {
    const s = annualSavingPercent(p);
    return s != null && (best == null || s > best) ? s : best;
  }, null);
  const hasAnnual = plans.some((p) => p.annualPrice != null);

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col items-center gap-3">
        {hasAnnual && (
          <BillingToggle
            value={view}
            onChange={setView}
            savingHint={bestSaving ? `Save up to ${bestSaving}% with annual billing` : null}
          />
        )}
        <p className="text-sm text-muted-foreground">
          {trialDays
            ? `Every eligible plan starts with a free ${trialDays}-day trial.`
            : "Eligible plans start with a free trial."}{" "}
          No card required to start. Prices exclude GST.
        </p>
      </div>

      <ul
        className={cn(
          "grid gap-5",
          plans.length === 1 && "mx-auto max-w-md",
          plans.length === 2 && "mx-auto max-w-3xl sm:grid-cols-2",
          plans.length >= 3 && "sm:grid-cols-2 lg:grid-cols-3",
          plans.length >= 4 && "xl:grid-cols-4",
        )}
      >
        {plans.map((plan) => (
          <li key={plan.key} className="flex">
            <PlanCard plan={plan} view={view} compact={variant === "teaser"} />
          </li>
        ))}
      </ul>

      {variant === "full" && <ComparisonTable plans={plans} />}
    </div>
  );
}

function PlanCard({
  plan,
  view,
  compact,
}: {
  plan: PublicPlan;
  view: BillingView;
  compact: boolean;
}) {
  const price = planPrice(plan, view);
  const custom = price.amount === null;
  const saving = view === "annual" ? annualSavingPercent(plan) : null;
  const limitEntries = LIMIT_KEYS.filter((k) => plan.limits[k] !== undefined);
  const features = compact ? plan.features.slice(0, 4) : plan.features;

  return (
    <article
      aria-labelledby={`plan-${plan.key}`}
      className="relative flex w-full flex-col gap-6 rounded-2xl border bg-card p-6 shadow-xs motion-safe:transition-[box-shadow,transform] motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-md"
    >
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 id={`plan-${plan.key}`} className="text-lg font-semibold tracking-tight">
            {plan.name}
          </h3>
          {saving ? (
            <Badge variant="success">Save {saving}%</Badge>
          ) : plan.isTrialEligible && !custom ? (
            <Badge variant="secondary">
              <SparklesIcon aria-hidden="true" />
              Free trial
            </Badge>
          ) : null}
        </div>
        {plan.description && (
          <p className="text-sm text-pretty text-muted-foreground">{plan.description}</p>
        )}
      </header>

      <div className="flex flex-col gap-1" data-numeric>
        {custom ? (
          <p className="text-3xl font-semibold tracking-tight">Custom</p>
        ) : (
          <p className="flex items-baseline gap-1">
            <span className="text-3xl font-semibold tracking-tight">{price.amount}</span>
            <span className="text-sm text-muted-foreground">{price.period}</span>
          </p>
        )}
        <p className="min-h-5 text-xs text-muted-foreground">
          {custom ? "Tailored pricing for larger groups" : price.note}
        </p>
      </div>

      {custom ? (
        <Button asChild variant="outline">
          <Link href="/contact">Contact us</Link>
        </Button>
      ) : plan.isTrialEligible ? (
        <Button asChild>
          <Link href="/sign-up">Start free trial</Link>
        </Button>
      ) : (
        <Button asChild variant="outline">
          <Link href="/contact">Talk to us</Link>
        </Button>
      )}

      {limitEntries.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-5 text-sm">
          {limitEntries.map((k) => (
            <div key={k} className="flex flex-col">
              <dt className="text-xs text-muted-foreground">{LIMIT_LABELS[k].label}</dt>
              <dd className="font-medium" data-numeric>
                {formatLimit(k, plan.limits[k])}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {features.length > 0 && (
        <ul className="flex flex-col gap-2 border-t pt-5 text-sm">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
              <span>{FEATURES[f]}</span>
            </li>
          ))}
          {compact && plan.features.length > features.length && (
            <li className="text-xs text-muted-foreground">
              + {plan.features.length - features.length} more
            </li>
          )}
        </ul>
      )}
    </article>
  );
}

function ComparisonTable({ plans }: { plans: PublicPlan[] }) {
  const limitRows = LIMIT_KEYS.filter((k) => plans.some((p) => p.limits[k] !== undefined));
  return (
    <section aria-labelledby="compare-heading" className="flex flex-col gap-4">
      <h2 id="compare-heading" className="text-center text-2xl font-semibold tracking-tight">
        Compare plans
      </h2>
      {/* Scrolls sideways on phones: a named region keyboard users can focus and scroll.
          Static (not measured) so it is right in the server-rendered HTML too. */}
      <div
        className="overflow-x-auto rounded-2xl border bg-card"
        tabIndex={0}
        role="region"
        aria-label="Plan comparison table"
      >
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">Plan limits and features</caption>
          <thead>
            <tr className="border-b bg-muted/40">
              <th scope="col" className="w-1/3 px-4 py-3 text-left font-medium">
                <span className="sr-only">Feature</span>
              </th>
              {plans.map((p) => (
                <th key={p.key} scope="col" className="px-4 py-3 text-center font-semibold">
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {limitRows.length > 0 && <GroupRow label="Limits" span={plans.length + 1} />}
            {limitRows.map((k) => (
              <tr key={k} className="border-b last:border-0">
                <th scope="row" className="px-4 py-3 text-left font-normal text-muted-foreground">
                  {LIMIT_LABELS[k].label}
                </th>
                {plans.map((p) => (
                  <td key={p.key} className="px-4 py-3 text-center font-medium">
                    {formatLimit(k, p.limits[k])}
                  </td>
                ))}
              </tr>
            ))}
            <GroupRow label="Features" span={plans.length + 1} />
            {ADVERTISED_FEATURES.map((f) => (
              <tr key={f} className="border-b last:border-0">
                <th scope="row" className="px-4 py-3 text-left font-normal text-muted-foreground">
                  {FEATURES[f]}
                </th>
                {plans.map((p) => (
                  <td key={p.key} className="px-4 py-3 text-center">
                    {p.features.includes(f) ? (
                      <CheckIcon className="mx-auto size-4 text-success" aria-label="Included" />
                    ) : (
                      <MinusIcon
                        className="mx-auto size-4 text-muted-foreground/50"
                        aria-label="Not included"
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GroupRow({ label, span }: { label: string; span: number }) {
  return (
    <tr className="border-b bg-muted/20">
      <th
        scope="colgroup"
        colSpan={span}
        className="px-4 py-2 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase"
      >
        {label}
      </th>
    </tr>
  );
}

export function PlansSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading plans"
      className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
    >
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-5 rounded-2xl border bg-card p-6">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-10 w-full" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading plans…</span>
    </div>
  );
}
