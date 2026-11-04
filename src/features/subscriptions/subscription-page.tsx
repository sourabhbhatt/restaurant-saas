"use client";

import { Check, CreditCard, History, Minus, ShieldAlert, Sparkles } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import {
  EmptyState,
  ErrorState,
  PageHeader,
  PageSkeleton,
  StatusBadge,
} from "@/components/shared/feedback";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PublicPlanDto, SubscriptionOverviewDto } from "@/contracts/platform";
import {
  FEATURE_KEYS,
  FEATURES,
  LIMIT_KEYS,
  type LimitKey,
} from "@/domain/subscriptions/entitlements";
import { errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import { useSubscriptionOverview } from "./queries";
import {
  eventLabel,
  eventTone,
  formatDate,
  formatDateTime,
  formatLimit,
  formatPrice,
  LIMIT_TITLES,
  PHASE_LABEL,
  PHASE_TONE,
  toDate,
} from "./subscription-ui";
import { UpgradeModal } from "./upgrade-modal";

const USAGE_FIELD: Record<LimitKey, keyof SubscriptionOverviewDto["usage"]> = {
  maxRestaurants: "restaurants",
  maxBranches: "branches",
  maxStaff: "staff",
  maxTables: "tables",
  maxMenuItems: "menuItems",
  storageMb: "storageBytes",
};

function usedValue(d: SubscriptionOverviewDto, key: LimitKey): number {
  const v = d.usage[USAGE_FIELD[key]];
  return key === "storageMb" ? Math.ceil(v / (1024 * 1024)) : v;
}

function StatusNotice({ d }: { d: SubscriptionOverviewDto }) {
  const e = d.entitlements;
  if (e.phase === "SUSPENDED" || e.phase === "DEACTIVATED") {
    return (
      <Alert variant="destructive">
        <ShieldAlert aria-hidden />
        <AlertTitle>This workspace is {e.phase.toLowerCase()}</AlertTitle>
        <AlertDescription>
          Operational access is paused by the platform team. Your data is retained. Contact{" "}
          <a className="underline" href={`mailto:${d.supportEmail}`}>
            {d.supportEmail}
          </a>{" "}
          or{" "}
          <Link className="underline" href={`/app/w/${d.workspaceId}/support`}>
            open a support request
          </Link>
          .
        </AlertDescription>
      </Alert>
    );
  }
  if (e.phase === "GRACE") {
    return (
      <Alert variant="warning">
        <ShieldAlert aria-hidden />
        <AlertTitle>Grace period until {formatDate(e.graceEndsAt)}</AlertTitle>
        <AlertDescription>
          Orders, menus and billing keep working. Adding restaurants, branches and staff is paused
          until you upgrade.
        </AlertDescription>
      </Alert>
    );
  }
  if (e.phase === "RESTRICTED" || e.phase === "NONE") {
    return (
      <Alert variant="destructive">
        <ShieldAlert aria-hidden />
        <AlertTitle>
          {e.accessLevel === "NONE" ? "Access is paused" : "The workspace is read-only"}
        </AlertTitle>
        <AlertDescription>
          Nothing has been deleted. Request an upgrade and our team will restore full access.
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}

function CurrentPlanCard({ d, onUpgrade }: { d: SubscriptionOverviewDto; onUpgrade: () => void }) {
  const e = d.entitlements;
  const sub = d.subscription;
  const plan = d.currentPlan;
  const price =
    plan && sub ? (sub.billingCycle === "ANNUAL" ? plan.annualPrice : plan.monthlyPrice) : null;
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardDescription>Current plan</CardDescription>
        <CardTitle className="flex flex-wrap items-center gap-3 text-2xl">
          {e.planName ?? "No plan"}
          <StatusBadge tone={PHASE_TONE[e.phase]} dot>
            {PHASE_LABEL[e.phase]}
          </StatusBadge>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {plan?.description ? (
          <p className="text-sm text-muted-foreground">{plan.description}</p>
        ) : null}
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Billing</dt>
            <dd className="font-medium">
              {sub?.status === "TRIALING"
                ? "Free trial"
                : sub?.billingCycle === "ANNUAL"
                  ? "Annual"
                  : "Monthly"}
            </dd>
          </div>
          {plan && sub?.status !== "TRIALING" ? (
            <div>
              <dt className="text-muted-foreground">Price</dt>
              <dd className="font-medium tabular-nums">{formatPrice(price, plan.currency)}</dd>
            </div>
          ) : null}
          {sub?.status === "TRIALING" ? (
            <div>
              <dt className="text-muted-foreground">Trial ends</dt>
              <dd className="font-medium">{formatDate(sub.trialEndsAt)}</dd>
            </div>
          ) : (
            <div>
              <dt className="text-muted-foreground">
                {sub?.status === "CANCELLED" ? "Access until" : "Current period ends"}
              </dt>
              <dd className="font-medium">{formatDate(sub?.currentPeriodEnd)}</dd>
            </div>
          )}
        </dl>
        {d.canRequestUpgrade ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={onUpgrade} disabled={d.workspaceStatus !== "ACTIVE"}>
              <Sparkles aria-hidden />
              {e.phase === "ACTIVE" ? "Change plan" : "Upgrade"}
            </Button>
            {d.pendingUpgrade ? (
              <p className="self-center text-sm text-muted-foreground">
                Upgrade requested {formatDate(d.pendingUpgrade.createdAt)} — our team will contact
                you.
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TrialCard({ d }: { d: SubscriptionOverviewDto }) {
  const e = d.entitlements;
  const sub = d.subscription;
  const start = toDate(sub?.trialStartsAt);
  const end = toDate(e.trialEndsAt);
  if (sub?.status !== "TRIALING" || !start || !end) {
    const periodEnd = toDate(e.periodEndsAt);
    return (
      <Card>
        <CardHeader>
          <CardDescription>Renewal</CardDescription>
          <CardTitle className="text-2xl">{periodEnd ? formatDate(periodEnd) : "—"}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {sub?.status === "CANCELLED"
            ? "Cancelled — the plan won't renew. Access continues until the date above."
            : "Plans are renewed by our team. You'll get reminders before the period ends."}
        </CardContent>
      </Card>
    );
  }
  const total = Math.max(1, end.getTime() - start.getTime());
  const days = e.trialDaysRemaining ?? 0;
  const elapsed = Math.min(total, Math.max(0, total - days * 86_400_000));
  const pct = Math.round((elapsed / total) * 100);
  return (
    <Card>
      <CardHeader>
        <CardDescription>Free trial</CardDescription>
        <CardTitle className="text-2xl tabular-nums">
          {days} day{days === 1 ? "" : "s"} left
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        <Progress
          value={pct}
          aria-label={`Trial ${pct}% used`}
          indicatorClassName={days <= 7 ? "bg-warning" : undefined}
        />
        <p className="flex justify-between text-xs text-muted-foreground">
          <span>Started {formatDate(start)}</span>
          <span>Ends {formatDate(end)}</span>
        </p>
      </CardContent>
    </Card>
  );
}

function UsageMeters({ d }: { d: SubscriptionOverviewDto }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage</CardTitle>
        <CardDescription>What your workspace uses against the plan limits.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {LIMIT_KEYS.map((key) => {
            const limit = d.entitlements.limits[key];
            const used = usedValue(d, key);
            const pct = limit === null ? 0 : limit === 0 ? 100 : Math.round((used / limit) * 100);
            const near = limit !== null && pct >= 80;
            return (
              <li key={key} className="grid gap-2">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{LIMIT_TITLES[key]}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {key === "storageMb" ? `${used} MB` : used.toLocaleString("en-IN")} /{" "}
                    {limit === null ? "Unlimited" : formatLimit(key, limit).split(" ")[0]}
                  </span>
                </div>
                <Progress
                  value={limit === null ? 0 : pct}
                  aria-label={`${LIMIT_TITLES[key]}: ${used} of ${limit ?? "unlimited"}`}
                  indicatorClassName={cn(near && "bg-warning", pct >= 100 && "bg-destructive")}
                />
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function PlanComparison({
  plans,
  currentKey,
  canRequest,
  onChoose,
}: {
  plans: PublicPlanDto[];
  currentKey: string | null;
  canRequest: boolean;
  onChoose: (key: string) => void;
}) {
  if (plans.length === 0) {
    return <EmptyState title="No plans published yet" description="Check back soon." />;
  }
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="border-b py-5">
        <CardTitle>Compare plans</CardTitle>
        <CardDescription>
          Prices exclude GST. Limits and features come from our live plans.
        </CardDescription>
      </CardHeader>
      <div className="overflow-x-auto">
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="w-48">
                <span className="sr-only">Feature</span>
              </TableHead>
              {plans.map((p) => (
                <TableHead
                  key={p.key}
                  scope="col"
                  className={cn("text-center", p.key === currentKey && "bg-primary/5")}
                >
                  <span className="flex flex-col items-center gap-1 py-2">
                    <span className="text-base font-semibold text-foreground">{p.name}</span>
                    {p.key === currentKey ? <StatusBadge tone="info">Your plan</StatusBadge> : null}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium">Monthly</TableCell>
              {plans.map((p) => (
                <TableCell key={p.key} className="text-center tabular-nums">
                  {formatPrice(p.monthlyPrice, p.currency)}
                </TableCell>
              ))}
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Annual</TableCell>
              {plans.map((p) => (
                <TableCell key={p.key} className="text-center tabular-nums">
                  {formatPrice(p.annualPrice, p.currency)}
                </TableCell>
              ))}
            </TableRow>
            {LIMIT_KEYS.map((key) => (
              <TableRow key={key}>
                <TableCell className="font-medium">{LIMIT_TITLES[key]}</TableCell>
                {plans.map((p) => (
                  <TableCell key={p.key} className="text-center">
                    {p.limits[key] === null
                      ? "Unlimited"
                      : key === "storageMb"
                        ? formatLimit(key, p.limits[key])
                        : p.limits[key]!.toLocaleString("en-IN")}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {FEATURE_KEYS.map((f) => (
              <TableRow key={f}>
                <TableCell className="font-medium">{FEATURES[f]}</TableCell>
                {plans.map((p) => {
                  const has = p.features.some((x) => x.key === f);
                  return (
                    <TableCell key={p.key} className="text-center">
                      {has ? (
                        <Check className="mx-auto size-4 text-success" aria-label="Included" />
                      ) : (
                        <Minus
                          className="mx-auto size-4 text-muted-foreground"
                          aria-label="Not included"
                        />
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
            {canRequest ? (
              <TableRow className="hover:bg-transparent">
                <TableCell />
                {plans.map((p) => (
                  <TableCell key={p.key} className="py-4 text-center">
                    <Button
                      size="sm"
                      variant={p.key === currentKey ? "outline" : "default"}
                      onClick={() => onChoose(p.key)}
                    >
                      {p.monthlyPrice === null ? "Contact us" : "Request"}
                    </Button>
                  </TableCell>
                ))}
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function HistoryTimeline({ d }: { d: SubscriptionOverviewDto }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="size-4" aria-hidden /> History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {d.history.length === 0 ? (
          <EmptyState size="compact" title="No subscription changes yet" />
        ) : (
          <ol className="relative grid gap-5 border-l pl-5">
            {d.history.map((ev) => (
              <li key={ev.id} className="relative">
                <span
                  aria-hidden
                  className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-background bg-primary"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={eventTone(ev.type)}>{eventLabel(ev.type)}</StatusBadge>
                  {ev.planKey ? (
                    <span className="text-xs text-muted-foreground uppercase">{ev.planKey}</span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(ev.createdAt)}
                  {ev.actorName ? ` · ${ev.actorName}` : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/** /app/w/[workspaceId]/subscription */
export function SubscriptionPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const overview = useSubscriptionOverview(workspaceId);
  const [upgrade, setUpgrade] = useState<{ open: boolean; planKey?: string }>({ open: false });

  if (overview.isPending) return <PageSkeleton variant="cards" count={3} />;
  if (overview.isError) {
    return (
      <ErrorState
        title="We couldn't load your subscription"
        message={errorMessage(overview.error)}
        onRetry={() => void overview.refetch()}
        retrying={overview.isFetching}
      />
    );
  }
  const d = overview.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Subscription"
        description="Your plan, trial, usage and plan options."
        actions={
          d.canRequestUpgrade && d.workspaceStatus === "ACTIVE" ? (
            <Button onClick={() => setUpgrade({ open: true })}>
              <CreditCard aria-hidden /> Upgrade
            </Button>
          ) : null
        }
      />
      <StatusNotice d={d} />
      <div className="grid gap-4 lg:grid-cols-3">
        <CurrentPlanCard d={d} onUpgrade={() => setUpgrade({ open: true })} />
        <TrialCard d={d} />
      </div>
      <UsageMeters d={d} />
      <PlanComparison
        plans={d.availablePlans}
        currentKey={d.currentPlan?.key ?? null}
        canRequest={d.canRequestUpgrade && d.workspaceStatus === "ACTIVE"}
        onChoose={(planKey) => setUpgrade({ open: true, planKey })}
      />
      <HistoryTimeline d={d} />
      <UpgradeModal
        workspaceId={workspaceId}
        open={upgrade.open}
        initialPlanKey={upgrade.planKey}
        onOpenChange={(open) => setUpgrade((u) => ({ ...u, open }))}
      />
    </div>
  );
}
