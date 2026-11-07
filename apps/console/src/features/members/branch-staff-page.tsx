"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import Link from "next/link";

import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FormError,
  PageHeader,
  PageSkeleton,
} from "@ros/ui/shared/feedback";
import { Badge } from "@ros/ui/ui/badge";
import { Button } from "@ros/ui/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ros/ui/ui/card";
import { FormField } from "@ros/ui/ui/form-field";
import type { BranchStaffDto } from "@ros/contracts/tenancy";
import { useBranchContext } from "@ros/web-core/features/session/queries";
import { api, errorMessage } from "@ros/api-client";
import { useAction } from "@ros/web-core/use-action";

const selectClass = "border-input bg-background h-10 w-full rounded-md border px-3 text-sm";

export function BranchStaffPage() {
  const { branchId } = useParams<{ branchId: string }>();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["branch", branchId, "staff"],
    queryFn: ({ signal }) =>
      api.get<BranchStaffDto>(`/branches/${branchId}/staff`, undefined, signal),
  });
  const [membershipId, setMembershipId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [wide, setWide] = useState(false);
  const [removing, setRemoving] = useState<BranchStaffDto["assignments"][number] | null>(null);
  const { pending, run, err, formError, setFieldErrors } = useAction();
  const ctx = useBranchContext(branchId);
  const refresh = () => qc.invalidateQueries({ queryKey: ["branch", branchId, "staff"] });

  if (q.isPending) return <PageSkeleton variant="list" />;
  if (q.isError)
    return (
      <ErrorState
        title="Couldn't load staff"
        message={errorMessage(q.error)}
        onRetry={() => void q.refetch()}
      />
    );
  const { assignments, candidates, roles } = q.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Staff"
        description="Who can work in this branch, and in which role (e.g. waiter, kitchen, cashier). Assigning a role doesn't use a staff seat; seats are counted per workspace member."
      />
      <Card>
        <CardHeader>
          <CardTitle>Assign role</CardTitle>
          <CardDescription>
            Choose an existing workspace member. To add someone new, invite them from the{" "}
            {ctx.data ? (
              <Link
                className="font-medium text-foreground underline underline-offset-4"
                href={`/app/w/${ctx.data.workspaceId}/members`}
              >
                Members page
              </Link>
            ) : (
              "workspace Members page"
            )}{" "}
            first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-3"
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              const local: Record<string, string[]> = {};
              if (!membershipId) local.membershipId = ["Choose a member"];
              if (!roleId) local.roleId = ["Choose a role"];
              if (Object.keys(local).length > 0) {
                setFieldErrors(local);
                return;
              }
              const ok = await run(() =>
                api.post(`/branches/${branchId}/staff`, {
                  membershipId,
                  roleId,
                  restaurantWide: wide,
                }),
              );
              if (ok) {
                toast.success("Role assigned");
                setMembershipId("");
                void refresh();
              }
            }}
          >
            <FormField
              label="Member"
              required
              description={
                candidates.length === 0
                  ? "Everyone in the workspace already has a role here."
                  : undefined
              }
              error={err("membershipId")}
            >
              <select
                className={selectClass}
                value={membershipId}
                onChange={(e) => setMembershipId(e.target.value)}
              >
                <option value="">Choose a member…</option>
                {candidates.map((c) => (
                  <option key={c.membershipId} value={c.membershipId}>
                    {c.name} ({c.email})
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Role" required error={err("roleId")}>
              <select
                className={selectClass}
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
              >
                <option value="">Choose a role…</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </FormField>
            <label className="flex items-start gap-2 self-end pb-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={wide}
                onChange={(e) => setWide(e.target.checked)}
              />
              <span>
                All branches of the restaurant
                <span className="block text-xs text-muted-foreground">Off: this branch only.</span>
              </span>
            </label>
            <div className="flex flex-col gap-3 sm:col-span-3">
              <FormError>{formError}</FormError>
              <Button type="submit" disabled={pending} className="self-start">
                {pending ? "Assigning…" : "Assign role"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      {assignments.length === 0 ? (
        <EmptyState
          title="No staff assigned"
          description="Assign a member above to give them access to this branch. Workspace owners and admins already have access everywhere."
        />
      ) : (
        assignments.map((a) => (
          <Card key={a.id}>
            <CardContent className="flex flex-wrap items-center gap-3 pt-6">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{a.name}</p>
                <p className="truncate text-sm text-muted-foreground">{a.email}</p>
              </div>
              <Badge>{a.role.name}</Badge>
              <Badge variant="outline">{a.branchId ? "This branch" : "All branches"}</Badge>
              <Button size="sm" variant="outline" onClick={() => setRemoving(a)}>
                Remove role
              </Button>
            </CardContent>
          </Card>
        ))
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name ?? "this person"}'s ${removing?.role.name ?? ""} role?`}
        description={
          removing?.branchId
            ? "They can no longer work at this branch. They stay a workspace member, and their past orders stay in the history."
            : "They can no longer work at any branch of this restaurant. They stay a workspace member, and their past orders stay in the history."
        }
        confirmLabel="Remove role"
        destructive
        getErrorMessage={errorMessage}
        onConfirm={async () => {
          if (!removing) return;
          await api.delete(`/branches/${branchId}/staff/${removing.id}`);
          toast.success("Role removed");
          await refresh();
        }}
      />
    </div>
  );
}
