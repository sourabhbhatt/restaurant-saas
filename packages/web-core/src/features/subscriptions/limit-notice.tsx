"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Gauge, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@ros/ui/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ros/ui/ui/card";
import { FormError } from "@ros/ui/shared/feedback";
import { Progress } from "@ros/ui/ui/progress";
import { cn } from "@ros/ui/utils";
import type { WorkspaceUsageDto } from "@ros/contracts/platform";
import type { Entitlements, LimitKey } from "@ros/domain/subscriptions/entitlements";
import type { ApiError } from "@ros/api-client";

import {
  accessBlockReason,
  canAdd,
  isPlanError,
  planLabel,
  planLimitsSentence,
  usageSummary,
  usedFor,
  type AddCheck,
} from "./limits";
import { invalidateEntitlements, useEntitlements } from "./queries";
import { LIMIT_TITLES } from "./subscription-ui";

export const subscriptionHref = (workspaceId: string) => `/app/w/${workspaceId}/subscription`;

/**
 * Plan check for one create action. `check` is null until entitlements load:
 * the button stays enabled meanwhile and the server decides.
 */
export function useLimit(
  workspaceId: string | undefined,
  key: LimitKey,
  opts: { adding?: number; check?: (ent: Entitlements, usage: WorkspaceUsageDto) => AddCheck } = {},
) {
  const query = useEntitlements(workspaceId);
  const data = query.data;
  const check = data
    ? (opts.check?.(data.entitlements, data.usage) ??
      canAdd(data.entitlements, data.usage, key, opts.adding ?? 1))
    : null;
  return { query, data, check, reason: check?.reason ?? null };
}

/** "2 of 3 restaurants used on Pro" with a progress bar. */
export function UsageMeter({
  entitlements,
  usage,
  limitKey,
  className,
}: {
  entitlements: Entitlements;
  usage: WorkspaceUsageDto;
  limitKey: LimitKey;
  className?: string;
}) {
  const limit = entitlements.limits[limitKey];
  const used = usedFor(usage, limitKey);
  const pct = limit === null ? 0 : limit === 0 ? 100 : Math.round((used / limit) * 100);
  const summary = usageSummary(entitlements, usage, limitKey);
  return (
    <div data-slot="usage-meter" className={cn("grid gap-1.5", className)}>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Gauge className="size-4 shrink-0" aria-hidden />
        <span>{summary}</span>
      </p>
      {limit !== null && (
        <Progress
          value={pct}
          aria-label={summary}
          indicatorClassName={cn(pct >= 80 && "bg-warning", pct >= 100 && "bg-destructive")}
        />
      )}
    </div>
  );
}

/**
 * Usage meter plus, when growth is blocked, why and what to do about it
 * (link to the subscription page). Pass `check` to override the default
 * `canAdd` (e.g. branches also need the multi-branch feature).
 */
export function LimitNoticeView({
  workspaceId,
  limitKey,
  entitlements,
  usage,
  check,
  scopeNote,
  className,
}: {
  workspaceId: string;
  limitKey: LimitKey;
  entitlements: Entitlements;
  usage: WorkspaceUsageDto;
  check?: AddCheck;
  /** Extra sentence, e.g. "Branches count across all restaurants." */
  scopeNote?: string;
  className?: string;
}) {
  const result = check ?? canAdd(entitlements, usage, limitKey);
  if (result.allowed) {
    return (
      <div className={cn("grid gap-1", className)}>
        <UsageMeter entitlements={entitlements} usage={usage} limitKey={limitKey} />
        {scopeNote ? <p className="text-xs text-muted-foreground">{scopeNote}</p> : null}
      </div>
    );
  }
  const access = result.blockedBy === "access";
  return (
    <Alert
      variant={entitlements.accessLevel === "NONE" ? "destructive" : "warning"}
      className={className}
    >
      <ShieldAlert aria-hidden />
      <AlertTitle>
        {access
          ? "Adding is paused"
          : result.blockedBy === "feature"
            ? "Not included in your plan"
            : `${LIMIT_TITLES[limitKey]} limit reached`}
      </AlertTitle>
      <AlertDescription>
        <p>{result.reason}</p>
        <UsageMeter
          entitlements={entitlements}
          usage={usage}
          limitKey={limitKey}
          className="w-full max-w-sm"
        />
        {scopeNote ? <p className="text-xs">{scopeNote}</p> : null}
        <Link
          href={subscriptionHref(workspaceId)}
          className="font-medium text-foreground underline underline-offset-4"
        >
          {entitlements.accessLevel === "NONE"
            ? "View subscription and support options"
            : access
              ? "Renew your plan"
              : "Compare plans and upgrade"}
        </Link>
      </AlertDescription>
    </Alert>
  );
}

/** Connected LimitNotice: loads entitlements itself; renders nothing until they arrive. */
export function LimitNotice({
  workspaceId,
  limitKey,
  check,
  scopeNote,
  className,
}: {
  workspaceId: string | undefined;
  limitKey: LimitKey;
  check?: (ent: Entitlements, usage: WorkspaceUsageDto) => AddCheck;
  scopeNote?: string;
  className?: string;
}) {
  const { data } = useEntitlements(workspaceId);
  if (!data || !workspaceId) return null;
  return (
    <LimitNoticeView
      workspaceId={workspaceId}
      limitKey={limitKey}
      entitlements={data.entitlements}
      usage={data.usage}
      check={check?.(data.entitlements, data.usage)}
      scopeNote={scopeNote}
      className={className}
    />
  );
}

/**
 * Inline message for a plan error the server returned anyway (e.g. another
 * admin used the last slot a moment ago). Shows the server's own words.
 * Renders nothing for other errors.
 */
export function PlanErrorNotice({
  error,
  workspaceId,
  className,
}: {
  error: unknown;
  workspaceId: string | undefined;
  className?: string;
}) {
  if (!isPlanError(error)) return null;
  return (
    <FormError className={className}>
      <p>
        {error.code === "WORKSPACE_RESTRICTED"
          ? error.message
          : `${error.message.replace(/\.$/, "")}. Upgrade to add more.`}
      </p>
      {workspaceId ? (
        <Link
          href={subscriptionHref(workspaceId)}
          className="font-medium underline underline-offset-4"
        >
          View plans
        </Link>
      ) : null}
    </FormError>
  );
}

/**
 * Holds a plan error from a create call so the form can show it inline next
 * to its submit button, and refreshes usage so the page's meter catches up.
 * `capture` returns false for any other error (rethrow or handle it as usual).
 */
export function usePlanError(workspaceId?: string) {
  const qc = useQueryClient();
  const [error, setError] = useState<ApiError | null>(null);
  const capture = useCallback(
    (e: unknown) => {
      if (!isPlanError(e)) return false;
      setError(e);
      void invalidateEntitlements(qc, workspaceId);
      return true;
    },
    [qc, workspaceId],
  );
  const clear = useCallback(() => setError(null), []);
  return { error, capture, clear };
}

/** "Your plan (Pro): up to 3 restaurants, 10 branches, …" for explanatory copy. */
export function PlanLimitsLine({ entitlements }: { entitlements: Entitlements }) {
  return (
    <p>
      <strong>Your plan ({planLabel(entitlements)}):</strong> {planLimitsSentence(entitlements)} in
      this workspace. Limits are totals for the whole workspace, so branches count across all
      restaurants and tables across all branches.
    </p>
  );
}

/** Compact usage meters for the main limits, e.g. on the workspace overview. */
export function PlanUsageCard({
  workspaceId,
  keys = ["maxRestaurants", "maxBranches", "maxTables", "maxStaff"],
}: {
  workspaceId: string;
  keys?: LimitKey[];
}) {
  const { data } = useEntitlements(workspaceId);
  if (!data) return null;
  const blocked = accessBlockReason(data.entitlements);
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-base">Plan usage</CardTitle>
        <CardDescription>
          {blocked ??
            `What this workspace uses on ${planLabel(data.entitlements)}. Limits are workspace-wide totals.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="grid gap-4 sm:grid-cols-2">
          {keys.map((key) => (
            <li key={key}>
              <UsageMeter entitlements={data.entitlements} usage={data.usage} limitKey={key} />
            </li>
          ))}
        </ul>
        <Link
          href={subscriptionHref(workspaceId)}
          className="text-sm font-medium underline underline-offset-4"
        >
          View plan and usage details
        </Link>
      </CardContent>
    </Card>
  );
}
