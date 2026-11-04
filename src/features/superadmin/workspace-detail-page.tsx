"use client";

import { UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { ErrorState, PageHeader, PageSkeleton } from "@/components/shared/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { errorMessage } from "@/lib/api-client";

import { useAdminWorkspace } from "./queries";
import {
  ActivateSubscriptionDialog,
  ExtendTrialDialog,
  ReasonConfirmDialog,
  useReasonActionState,
  useReasonActions,
} from "./workspace-actions";
import { WorkspaceStatusBadge } from "./workspace-status-badge";

const date = (v: string | null) => (v ? new Date(v).toLocaleDateString() : "—");

/** /admin/workspaces/[workspaceId] */
export function AdminWorkspaceDetailPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const q = useAdminWorkspace(workspaceId);
  const actions = useReasonActions(workspaceId);
  const [action, setAction] = useReasonActionState();
  const [activate, setActivate] = useState(false);
  const [extend, setExtend] = useState(false);

  if (q.isPending) return <PageSkeleton variant="detail" />;
  if (q.isError)
    return (
      <ErrorState
        title="Couldn't load workspace"
        message={errorMessage(q.error)}
        onRetry={() => void q.refetch()}
      />
    );
  const d = q.data;
  const e = d.entitlements;
  const copy: Record<
    string,
    {
      title: string;
      description: string;
      label: string;
      destructive?: boolean;
      run: (reason: string) => Promise<unknown>;
      done: string;
    }
  > = {
    SUSPENDED: {
      title: "Suspend workspace?",
      description: "Staff lose operational access immediately. Data is kept.",
      label: "Suspend",
      destructive: true,
      run: (reason) => actions.status.mutateAsync({ status: "SUSPENDED", reason }),
      done: "Workspace suspended",
    },
    DEACTIVATED: {
      title: "Deactivate workspace?",
      description: "Blocks all access. Data is kept.",
      label: "Deactivate",
      destructive: true,
      run: (reason) => actions.status.mutateAsync({ status: "DEACTIVATED", reason }),
      done: "Workspace deactivated",
    },
    ACTIVE: {
      title: "Reactivate workspace?",
      description: "Restores access according to its subscription.",
      label: "Reactivate",
      run: (reason) => actions.status.mutateAsync({ status: "ACTIVE", reason }),
      done: "Workspace reactivated",
    },
    cancel: {
      title: "Cancel subscription?",
      description: "Access continues until the period ends.",
      label: "Cancel subscription",
      destructive: true,
      run: (reason) => actions.cancel.mutateAsync({ reason }),
      done: "Subscription cancelled",
    },
    expire: {
      title: "Expire subscription now?",
      description: "Starts the grace period immediately.",
      label: "Expire now",
      destructive: true,
      run: (reason) => actions.expire.mutateAsync({ reason }),
      done: "Subscription expired",
    },
  };
  const cur = action ? copy[action] : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={d.workspace.name}
        description={`${d.workspace.slug} · created ${date(d.workspace.createdAt)}`}
        actions={<WorkspaceStatusBadge status={d.workspace.status} />}
      />
      <Card>
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p>
            Plan <strong>{e.planName ?? "none"}</strong> · phase{" "}
            <Badge variant="outline">{e.phase}</Badge> · access{" "}
            {e.accessLevel.toLowerCase().replace("_", "-")}
            {e.trialDaysRemaining !== null ? ` · ${e.trialDaysRemaining} trial days left` : ""}
          </p>
          <p className="text-muted-foreground">
            Usage: {d.usage.restaurants} restaurants · {d.usage.branches} branches · {d.usage.staff}{" "}
            staff · {d.usage.tables} tables · {d.usage.menuItems} menu items
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setActivate(true)}>Activate / change plan</Button>
            <Button variant="outline" onClick={() => setExtend(true)}>
              Extend trial
            </Button>
            <Button variant="outline" onClick={() => setAction("cancel")}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => setAction("expire")}>
              Expire now
            </Button>
            {d.workspace.status === "ACTIVE" ? (
              <>
                <Button variant="outline" onClick={() => setAction("SUSPENDED")}>
                  Suspend
                </Button>
                <Button variant="outline" onClick={() => setAction("DEACTIVATED")}>
                  Deactivate
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setAction("ACTIVE")}>
                Reactivate
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Members ({d.members.length})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {d.members.map((m) => (
              <div key={m.membershipId} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {m.name} <span className="text-muted-foreground">{m.email}</span>
                </span>
                <Badge variant="secondary">{m.roleName}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Restaurants &amp; branches</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {d.restaurants.map((r) => (
              <div key={r.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{r.name}</p>
                  <p className="text-muted-foreground">
                    {r.branches.map((b) => b.name).join(", ") || "No branches"}
                  </p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/admin/workspaces/${workspaceId}/restaurants/${r.id}`}>
                    <UtensilsCrossed aria-hidden /> View menu
                  </Link>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Subscription history</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          {d.history.length === 0 ? (
            <p className="text-muted-foreground">No events yet.</p>
          ) : (
            d.history.map((h) => (
              <p key={h.id}>
                {date(h.createdAt)} · {h.type.replace(/_/g, " ")}
                {h.planKey ? ` (${h.planKey})` : ""}
              </p>
            ))
          )}
        </CardContent>
      </Card>
      <ActivateSubscriptionDialog
        workspaceId={workspaceId}
        plans={d.plans}
        currentPlanKey={e.planKey}
        open={activate}
        onOpenChange={setActivate}
      />
      <ExtendTrialDialog workspaceId={workspaceId} open={extend} onOpenChange={setExtend} />
      {cur && (
        <ReasonConfirmDialog
          open
          onOpenChange={(o) => !o && setAction(null)}
          title={cur.title}
          description={cur.description}
          confirmLabel={cur.label}
          destructive={cur.destructive}
          onConfirm={cur.run}
          successMessage={cur.done}
        />
      )}
    </div>
  );
}
