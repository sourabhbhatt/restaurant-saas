"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, ErrorState, PageHeader, PageSkeleton } from "@ros/ui/shared/feedback";
import { Badge } from "@ros/ui/ui/badge";
import { Button } from "@ros/ui/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ros/ui/ui/card";
import { FormField } from "@ros/ui/ui/form-field";
import type { BranchStaffDto } from "@ros/contracts/tenancy";
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
  const { pending, run, err } = useAction();
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
        description="Who can work in this branch, and in which role. Invite new people from the workspace Members page."
      />
      <Card>
        <CardHeader>
          <CardTitle>Assign a role</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-3"
            onSubmit={async (e) => {
              e.preventDefault();
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
            <FormField label="Member" required error={err("membershipId")}>
              <select
                className={selectClass}
                value={membershipId}
                onChange={(e) => setMembershipId(e.target.value)}
              >
                <option value="">Choose…</option>
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
                <option value="">Choose…</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </FormField>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" checked={wide} onChange={(e) => setWide(e.target.checked)} />{" "}
              All branches of the restaurant
            </label>
            <div className="sm:col-span-3">
              <Button type="submit" disabled={pending}>
                {pending ? "Assigning…" : "Assign"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      {assignments.length === 0 ? (
        <EmptyState
          title="No staff assigned"
          description="Assign a member above to give them access to this branch."
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
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await api.delete(`/branches/${branchId}/staff/${a.id}`);
                    toast.success("Role removed");
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                  void refresh();
                }}
              >
                Remove
              </Button>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
