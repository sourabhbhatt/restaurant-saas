"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Circle,
  ClipboardList,
  CreditCard,
  MapPin,
  Receipt,
  Store,
  Users,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";

import { EmptyState, PageHeader, StatCard } from "@ros/ui/shared/feedback";
import { Button } from "@ros/ui/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ros/ui/ui/card";
import { Progress } from "@ros/ui/ui/progress";
import { Skeleton } from "@ros/ui/ui/skeleton";
import type { BranchComparisonRowDto } from "@ros/contracts/analytics";
import type { StructureBranchDto } from "@ros/contracts/structure";
import { ONBOARDING_STEPS } from "@ros/contracts/workspaces";
import { branchConsoles } from "../navigation/nav-config";
import { useAppLinks } from "../../app-links";
import {
  permissionChecker,
  useBranchContext,
  useMe,
  useWorkspaceStructure,
} from "../session/queries";
import { api, ApiError, errorMessage } from "@ros/api-client";

import { todayIn } from "./date-range-filter";
import { formatCount, formatMoney } from "./format";
import { analyticsKeys, useWorkspaceAnalytics, useWorkspaceDetail } from "./queries";
import { AnalyticsError } from "./shared";

const STEP_LABELS: Record<string, string> = {
  business: "Business details",
  restaurant: "First restaurant",
  branch: "First branch",
  settings: "Taxes & payments",
  menu: "Menu",
  tables: "Tables",
  qr: "QR codes",
  staff: "Invite staff",
};

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function OnboardingCard({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const detail = useWorkspaceDetail(workspaceId);
  const qc = useQueryClient();
  const dismiss = useMutation({
    mutationFn: () => api.put(`/workspaces/${workspaceId}/onboarding`, { dismiss: true }),
    onSuccess: async () => {
      toast.success("Setup checklist hidden");
      await qc.invalidateQueries({ queryKey: analyticsKeys.workspaceDetail(workspaceId) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const ob = detail.data?.workspace.onboarding;
  if (!ob || ob.currentStep === "done" || ob.dismissedAt) return null;
  const steps = ONBOARDING_STEPS.filter((s) => s !== "done");
  const done = new Set(ob.completedSteps);
  const pct = Math.round((steps.filter((s) => done.has(s)).length / steps.length) * 100);
  return (
    <Card className="gap-4 border-primary/30 bg-primary/[0.03]">
      <CardHeader>
        <CardTitle>Finish setting up your workspace</CardTitle>
        <CardDescription>
          {pct}% complete — pick up where you left off to start taking orders.
        </CardDescription>
        {canEdit && (
          <CardAction>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Hide setup checklist"
              disabled={dismiss.isPending}
              onClick={() => dismiss.mutate()}
            >
              <X aria-hidden />
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Progress value={pct} aria-label="Setup progress" />
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <li key={s} className="flex items-center gap-2 text-sm">
              {done.has(s) ? (
                <CheckCircle2 className="size-4 text-success" aria-hidden />
              ) : (
                <Circle className="size-4 text-muted-foreground" aria-hidden />
              )}
              <span className={done.has(s) ? "text-muted-foreground line-through" : undefined}>
                {STEP_LABELS[s] ?? s}
              </span>
              <span className="sr-only">{done.has(s) ? "(done)" : "(to do)"}</span>
            </li>
          ))}
        </ul>
        <div>
          <Button asChild>
            <Link href="/app/onboarding">
              Continue setup <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function BranchCard({
  branch,
  restaurantName,
  today,
}: {
  branch: StructureBranchDto;
  restaurantName: string;
  today?: BranchComparisonRowDto;
}) {
  const ctx = useBranchContext(branch.id);
  const links = useAppLinks();
  const can = permissionChecker(ctx.data?.permissions);
  const consoles = branchConsoles(branch.id, links.ops).filter(
    (c) => !c.permission || can(c.permission),
  );
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="text-base">
          <Link href={`/app/b/${branch.id}`} className="hover:underline">
            {branch.name}
          </Link>
        </CardTitle>
        <CardDescription className="flex items-center gap-1">
          {restaurantName}
          {branch.city && (
            <>
              {" · "}
              <MapPin className="size-3" aria-hidden /> {branch.city}
            </>
          )}
          {branch.status === "ARCHIVED" && " · Archived"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {today && (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Orders today</dt>
              <dd className="font-semibold tabular-nums">{formatCount(today.orders)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Collected today</dt>
              <dd className="font-semibold tabular-nums">
                {formatMoney(today.collected, today.currency)}
              </dd>
            </div>
          </dl>
        )}
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href={`/app/b/${branch.id}`}>Open branch</Link>
          </Button>
          {ctx.isPending ? (
            <Skeleton className="h-8 w-28" />
          ) : (
            consoles.map((c) => (
              <Button key={c.href} asChild size="sm" variant="outline">
                <Link href={c.href}>
                  <c.icon aria-hidden /> {c.label}
                </Link>
              </Button>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TodayKpis({ workspaceId }: { workspaceId: string }) {
  const today = todayIn();
  const q = useWorkspaceAnalytics(workspaceId, { from: today, to: today });
  if (q.isError && q.error instanceof ApiError && q.error.status === 403) return null;
  if (q.isError) {
    return (
      <AnalyticsError
        error={q.error}
        onRetry={() => void q.refetch()}
        retrying={q.isFetching}
        upgradeHref={`/app/w/${workspaceId}/subscription`}
      />
    );
  }
  const k = q.data?.kpis;
  const cur = q.data?.currency ?? "INR";
  const loading = q.isPending;
  return (
    <section aria-labelledby="today-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="today-heading" className="text-lg font-semibold tracking-tight">
          Today
        </h2>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/app/w/${workspaceId}/analytics`}>
            Analytics <ArrowRight aria-hidden />
          </Link>
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Collected"
          value={k ? formatMoney(k.collected, cur) : "—"}
          delta={q.data?.deltas.collected ?? undefined}
          deltaLabel="vs yesterday"
          icon={<Wallet />}
          loading={loading}
        />
        <StatCard
          label="Billed"
          value={k ? formatMoney(k.billed, cur) : "—"}
          icon={<Receipt />}
          loading={loading}
        />
        <StatCard
          label="Orders"
          value={k ? formatCount(k.totalOrders) : "—"}
          delta={q.data?.deltas.totalOrders ?? undefined}
          deltaLabel="vs yesterday"
          icon={<ClipboardList />}
          loading={loading}
        />
        <StatCard
          label="Pending now"
          value={k ? formatCount(k.pendingNow) : "—"}
          loading={loading}
        />
      </div>
    </section>
  );
}

/** /app/w/[workspaceId] — greeting, setup checklist, today's KPIs, branches and quick links. */
export function WorkspaceOverview() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const me = useMe();
  const structure = useWorkspaceStructure(workspaceId);
  const today = todayIn();
  const s = structure.data;
  const can = permissionChecker(s?.permissions);
  const analyticsAllowed = can("workspace.analytics.view");
  // Per-branch numbers for the cards come from the same request as the KPIs (cached).
  const todayReport = useWorkspaceAnalytics(
    workspaceId,
    { from: today, to: today },
    Boolean(s) && analyticsAllowed,
  );
  if (!s) return null; // The workspace shell renders loading/error states.

  const comparison =
    todayReport.data?.branchComparison.available === true
      ? new Map(todayReport.data.branchComparison.data.map((r) => [r.branchId, r]))
      : null;
  const branches = s.restaurants.flatMap((r) => r.branches.map((b) => ({ b, r })));
  const firstName = me.data?.user.name.split(" ")[0];

  const links = [
    {
      href: `/app/w/${workspaceId}/restaurants`,
      label: "Restaurants",
      icon: Store,
      perm: "workspace.view",
    },
    {
      href: `/app/w/${workspaceId}/members`,
      label: "Members",
      icon: Users,
      perm: "workspace.members.view",
    },
    {
      href: `/app/w/${workspaceId}/analytics`,
      label: "Analytics",
      icon: BarChart3,
      perm: "workspace.analytics.view",
    },
    {
      href: `/app/w/${workspaceId}/subscription`,
      label: "Subscription",
      icon: CreditCard,
      perm: "workspace.subscription.view",
    },
  ].filter((l) => can(l.perm));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={firstName ? `${greeting()}, ${firstName}` : greeting()}
        description={`Here's what's happening at ${s.workspaceName}.`}
      />
      {can("workspace.update") && <OnboardingCard workspaceId={workspaceId} canEdit />}
      {analyticsAllowed && <TodayKpis workspaceId={workspaceId} />}

      <section aria-labelledby="branches-heading" className="flex flex-col gap-3">
        <h2 id="branches-heading" className="text-lg font-semibold tracking-tight">
          {analyticsAllowed ? "Branches" : "Your branches"}
        </h2>
        {branches.length === 0 ? (
          <EmptyState
            icon={<Store />}
            title="No branches yet"
            description={
              can("restaurant.create")
                ? "Add your first restaurant and branch to start taking orders."
                : "You haven't been assigned to a branch yet. Ask your manager for access."
            }
            action={
              can("restaurant.create") ? (
                <Button asChild>
                  <Link href="/app/onboarding">Set up a restaurant</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {branches.map(({ b, r }) => (
              <BranchCard
                key={b.id}
                branch={b}
                restaurantName={r.name}
                today={comparison?.get(b.id)}
              />
            ))}
          </div>
        )}
      </section>

      {links.length > 0 && (
        <section aria-labelledby="links-heading" className="flex flex-col gap-3">
          <h2 id="links-heading" className="text-lg font-semibold tracking-tight">
            Quick links
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="flex items-center gap-3 rounded-xl border bg-card p-4 text-sm font-medium hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <l.icon className="size-4" aria-hidden />
                </span>
                {l.label}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
