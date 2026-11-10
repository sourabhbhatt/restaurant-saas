"use client";

import { EmptyState, ErrorState, LoadingState, StatusBadge } from "@ros/ui/shared/feedback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ros/ui/ui/card";
import { errorMessage } from "@ros/api-client";

import { useMyUpgradeRequests } from "./queries";
import { formatDate } from "./subscription-ui";

const TONE = {
  PENDING: "info",
  APPROVED: "success",
  REJECTED: "danger",
  CANCELLED: "neutral",
} as const;

/** The workspace's own upgrade requests and how each was decided. */
export function UpgradeRequestsCard({ workspaceId }: { workspaceId: string }) {
  const q = useMyUpgradeRequests(workspaceId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Upgrade requests</h2>
        </CardTitle>
        <CardDescription>Plan changes you asked for and what happened to them.</CardDescription>
      </CardHeader>
      <CardContent>
        {q.isPending ? (
          <LoadingState label="Loading requests…" />
        ) : q.isError ? (
          <ErrorState
            size="compact"
            message={errorMessage(q.error)}
            onRetry={() => void q.refetch()}
          />
        ) : q.data.length === 0 ? (
          <EmptyState
            size="compact"
            title="No requests yet"
            description="Use Upgrade above to ask for a different plan. Our team approves requests manually."
          />
        ) : (
          <ul className="flex flex-col divide-y">
            {q.data.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {r.currentPlan ? `${r.currentPlan.name} → ` : ""}
                    {r.requestedPlan.name}{" "}
                    <span className="font-normal text-muted-foreground">
                      ({r.billingCycle === "ANNUAL" ? "annual" : "monthly"})
                    </span>
                  </p>
                  <p className="text-muted-foreground">
                    Requested {formatDate(r.createdAt)}
                    {r.decidedAt ? ` · decided ${formatDate(r.decidedAt)}` : ""}
                  </p>
                  {r.status === "REJECTED" && r.decisionReason && (
                    <p className="mt-1">Reason: {r.decisionReason}</p>
                  )}
                </div>
                <StatusBadge tone={TONE[r.status]}>{r.status.toLowerCase()}</StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
