"use client";

import { ErrorState, PageHeader, PageSkeleton } from "@/components/shared/feedback";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ADVERTISED_FEATURES, LIMIT_KEYS, limitLabel } from "@/domain/subscriptions/entitlements";
import { formatMoney } from "@/domain/shared/money";
import { errorMessage } from "@/lib/api-client";

import { useAdminPlans } from "./queries";

/** /admin/plans — read-only overview. Editing plans is done through the API for now. */
export function AdminPlansPage() {
  const q = useAdminPlans();
  if (q.isPending) return <PageSkeleton variant="cards" />;
  if (q.isError)
    return (
      <ErrorState
        title="Couldn't load plans"
        message={errorMessage(q.error)}
        onRetry={() => void q.refetch()}
      />
    );
  const plans = Array.isArray(q.data) ? q.data : [];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Plans"
        description="Subscription plans and their limits. Editing from this screen is not built yet; use PUT /api/v1/admin/plans/:id."
      />
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => (
          <Card key={p.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                {p.name}{" "}
                <Badge variant={p.status === "ACTIVE" ? "success" : "outline"}>
                  {p.status.toLowerCase()}
                </Badge>
              </CardTitle>
              <CardDescription>{p.description}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <p className="text-lg font-semibold">
                {p.monthlyPrice === null
                  ? "Custom pricing"
                  : `${formatMoney(p.monthlyPrice, p.currency)} / month`}
              </p>
              {LIMIT_KEYS.map((k) => (
                <p key={k} className="text-muted-foreground">
                  {p.limits[k] ?? "Unlimited"} {limitLabel(k)}
                </p>
              ))}
              <p className="text-muted-foreground">
                Max workspaces:{" "}
                {p.maxWorkspaces === null
                  ? "Unlimited (fair use)"
                  : `${p.maxWorkspaces} on annual billing`}
              </p>
              <p className="text-muted-foreground">
                {p.features.filter((f) => ADVERTISED_FEATURES.includes(f)).length} features ·{" "}
                {p.activeSubscriptions} workspaces
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
