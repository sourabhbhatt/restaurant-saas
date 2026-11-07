"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FormError,
  GatedAction,
  PageHeader,
  PageSkeleton,
  StatusBadge,
} from "@ros/ui/shared/feedback";
import { Badge } from "@ros/ui/ui/badge";
import { Button } from "@ros/ui/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ros/ui/ui/card";
import { FormField } from "@ros/ui/ui/form-field";
import { Input } from "@ros/ui/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ros/ui/ui/tabs";
import type {
  CreatedInvitationDto,
  InvitationDto,
  MemberDto,
  RoleDto,
} from "@ros/contracts/tenancy";
import { permissionChecker, useWorkspaceStructure } from "@ros/web-core/features/session/queries";
import { isPlanError } from "@ros/web-core/features/subscriptions/limits";
import {
  LimitNotice,
  PlanErrorNotice,
  useLimit,
} from "@ros/web-core/features/subscriptions/limit-notice";
import { invalidateEntitlements } from "@ros/web-core/features/subscriptions/queries";
import { api, errorMessage } from "@ros/api-client";
import { useAction } from "@ros/web-core/use-action";

const selectClass = "border-input bg-background h-10 w-full rounded-md border px-3 text-sm";

function useList<T>(workspaceId: string, path: string) {
  return useQuery({
    queryKey: ["workspace", workspaceId, path],
    queryFn: ({ signal }) => api.get<T>(`/workspaces/${workspaceId}/${path}`, undefined, signal),
  });
}

function MembersTab({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const members = useList<MemberDto[]>(workspaceId, "members");
  const roles = useList<RoleDto[]>(workspaceId, "roles");
  const [removing, setRemoving] = useState<MemberDto | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["workspace", workspaceId, "members"] });
  if (members.isPending || roles.isPending) return <PageSkeleton variant="list" />;
  if (members.isError)
    return (
      <ErrorState
        title="Couldn't load members"
        message={errorMessage(members.error)}
        onRetry={() => void members.refetch()}
      />
    );
  const workspaceRoles = (roles.data ?? []).filter((r) => r.scope === "WORKSPACE");
  return (
    <div className="flex flex-col gap-3">
      {members.data.map((m) => (
        <Card key={m.membershipId}>
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{m.name}</p>
              <p className="truncate text-sm text-muted-foreground">{m.email}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {m.assignments.map((a) => (
                  <Badge key={a.id} variant="secondary">
                    {a.role.name} · {a.branchName ?? a.restaurantName}
                  </Badge>
                ))}
              </div>
            </div>
            {m.status === "DISABLED" && <StatusBadge tone="warning">Disabled</StatusBadge>}
            {canManage ? (
              <>
                <select
                  className={`${selectClass} w-44`}
                  aria-label={`Workspace role of ${m.name}`}
                  value={m.role.id}
                  onChange={async (e) => {
                    try {
                      await api.patch(`/workspaces/${workspaceId}/members/${m.membershipId}`, {
                        roleId: e.target.value,
                      });
                      toast.success("Role updated");
                    } catch (error) {
                      toast.error(errorMessage(error));
                    }
                    void refresh();
                  }}
                >
                  {workspaceRoles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <Button variant="outline" size="sm" onClick={() => setRemoving(m)}>
                  Remove member
                </Button>
              </>
            ) : (
              <Badge>{m.role.name}</Badge>
            )}
          </CardContent>
        </Card>
      ))}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name ?? "member"}?`}
        description="They lose access to this workspace and all its restaurants and branches immediately, and their staff seat on your plan is freed. Their past activity stays in the audit log. To give access again, send a new invitation."
        confirmLabel="Remove member"
        destructive
        getErrorMessage={errorMessage}
        onConfirm={async () => {
          await api.delete(`/workspaces/${workspaceId}/members/${removing!.membershipId}`);
          toast.success("Member removed");
          await Promise.all([refresh(), invalidateEntitlements(qc, workspaceId)]);
        }}
      />
    </div>
  );
}

function InvitationsTab({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const invites = useList<InvitationDto[]>(workspaceId, "invitations");
  const roles = useList<RoleDto[]>(workspaceId, "roles");
  const structure = useWorkspaceStructure(workspaceId);
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const [restaurantId, setRestaurantId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [assignRoleId, setAssignRoleId] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const { pending, run, err, error, formError, setFieldErrors } = useAction();
  const limit = useLimit(workspaceId, "maxStaff");
  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["workspace", workspaceId, "invitations"] });
  const wsRoles = (roles.data ?? []).filter((r) => r.scope === "WORKSPACE");
  const opRoles = (roles.data ?? []).filter((r) => r.scope !== "WORKSPACE");
  const effectiveRole = roleId || wsRoles.find((r) => r.key === "workspace_member")?.id || "";
  const restaurant = structure.data?.restaurants.find((r) => r.id === restaurantId);
  const selectedRole = wsRoles.find((r) => r.id === effectiveRole);

  return (
    <div className="flex flex-col gap-6">
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Invite member</CardTitle>
            <CardDescription>
              They get an email with a link to join. Pending invitations don&apos;t use a staff
              seat; the plan is checked again when they accept.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 sm:grid-cols-2"
              noValidate
              onSubmit={async (e) => {
                e.preventDefault();
                const local: Record<string, string[]> = {};
                if (!/^\S+@\S+\.\S+$/.test(email.trim()))
                  local.email = ["Enter a valid email address"];
                if (restaurantId && !assignRoleId)
                  local.assignmentRoleId = ["Choose their role at this restaurant"];
                if (Object.keys(local).length > 0) {
                  setFieldErrors(local);
                  return;
                }
                const res = await run(() =>
                  api.post<CreatedInvitationDto>(`/workspaces/${workspaceId}/invitations`, {
                    email,
                    workspaceRoleId: effectiveRole,
                    ...(restaurantId
                      ? {
                          restaurantId,
                          assignmentRoleId: assignRoleId || undefined,
                          branchId: branchId || undefined,
                        }
                      : {}),
                  }),
                );
                if (res) {
                  setLink(res.inviteUrl);
                  setEmail("");
                  toast.success("Invitation created");
                  void refresh();
                }
              }}
            >
              <FormField label="Email" required error={err("email")}>
                <Input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </FormField>
              <FormField
                label="Workspace role"
                required
                description={
                  selectedRole?.description ??
                  "What they can do across the whole workspace (team, billing, all restaurants)."
                }
                error={err("workspaceRoleId")}
              >
                <select
                  className={selectClass}
                  value={effectiveRole}
                  onChange={(e) => setRoleId(e.target.value)}
                >
                  {wsRoles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField
                label="Restaurant (optional)"
                description="Give them a job at one restaurant, e.g. waiter or manager."
                error={err("restaurantId")}
              >
                <select
                  className={selectClass}
                  value={restaurantId}
                  onChange={(e) => {
                    setRestaurantId(e.target.value);
                    setBranchId("");
                  }}
                >
                  <option value="">No restaurant access yet</option>
                  {(structure.data?.restaurants ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </FormField>
              {restaurantId && (
                <>
                  <FormField
                    label="Branch"
                    description="Limit them to one location, or all branches of the restaurant."
                    error={err("branchId")}
                  >
                    <select
                      className={selectClass}
                      value={branchId}
                      onChange={(e) => setBranchId(e.target.value)}
                    >
                      <option value="">All branches</option>
                      {(restaurant?.branches ?? []).map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Role there" required error={err("assignmentRoleId")}>
                    <select
                      className={selectClass}
                      value={assignRoleId}
                      onChange={(e) => setAssignRoleId(e.target.value)}
                    >
                      <option value="">Choose a role…</option>
                      {opRoles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </FormField>
                </>
              )}
              <div className="flex flex-col gap-3 sm:col-span-2">
                <PlanErrorNotice error={error} workspaceId={workspaceId} />
                {!isPlanError(error) ? <FormError>{formError}</FormError> : null}
                <GatedAction reason={limit.reason} disabled={pending}>
                  {(gate) => (
                    <Button type="submit" {...gate}>
                      {pending ? "Sending…" : "Send invitation"}
                    </Button>
                  )}
                </GatedAction>
              </div>
            </form>
            {link && (
              <div className="mt-4 flex items-center gap-2 rounded-md bg-muted p-3 text-sm">
                <span className="min-w-0 flex-1 truncate">{link}</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await navigator.clipboard.writeText(link);
                    toast.success("Link copied");
                  }}
                >
                  <Copy className="size-4" aria-hidden /> Copy link
                </Button>
              </div>
            )}
            {link && (
              <p className="mt-2 text-xs text-muted-foreground">
                Email may not be delivered in development. Share this link directly.
              </p>
            )}
          </CardContent>
        </Card>
      )}
      {invites.isPending ? (
        <PageSkeleton variant="list" />
      ) : invites.isError ? (
        <ErrorState
          title="Couldn't load invitations"
          message={errorMessage(invites.error)}
          onRetry={() => void invites.refetch()}
        />
      ) : invites.data.length === 0 ? (
        <EmptyState
          title="No invitations yet"
          description={
            canManage
              ? "Invite staff by email with the form above and give them a role."
              : "Workspace owners and admins can invite staff."
          }
        />
      ) : (
        invites.data.map((i) => (
          <Card key={i.id}>
            <CardContent className="flex flex-wrap items-center gap-3 pt-6">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{i.email}</p>
                <p className="text-sm text-muted-foreground">
                  {i.workspaceRole.name}
                  {i.assignmentRole
                    ? ` · ${i.assignmentRole.name} at ${i.branchName ?? i.restaurantName}`
                    : ""}
                </p>
              </div>
              <StatusBadge
                tone={
                  i.status === "PENDING" && !i.expired
                    ? "info"
                    : i.status === "ACCEPTED"
                      ? "success"
                      : "neutral"
                }
              >
                {i.status === "PENDING" && i.expired
                  ? "Expired"
                  : i.status.charAt(0) + i.status.slice(1).toLowerCase()}
              </StatusBadge>
              {canManage && i.status === "PENDING" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await api.delete(`/workspaces/${workspaceId}/invitations/${i.id}`);
                      toast.success("Invitation revoked");
                    } catch (e) {
                      toast.error(errorMessage(e));
                    }
                    void refresh();
                  }}
                >
                  Revoke invitation
                </Button>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function RolesTab({ workspaceId }: { workspaceId: string }) {
  const roles = useList<RoleDto[]>(workspaceId, "roles");
  if (roles.isPending) return <PageSkeleton variant="list" />;
  if (roles.isError)
    return (
      <ErrorState
        title="Couldn't load roles"
        message={errorMessage(roles.error)}
        onRetry={() => void roles.refetch()}
      />
    );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {roles.data.map((r) => (
        <Card key={r.id}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              {r.name} <Badge variant="outline">{r.scope.toLowerCase()}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>{r.description}</p>
            <p className="mt-2">
              {r.permissions.length} permissions · used by {r.usageCount}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function MembersPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const structure = useWorkspaceStructure(workspaceId);
  const can = permissionChecker(structure.data?.permissions);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Members"
        description="People who can sign in to this workspace. A workspace role sets what they can do everywhere; restaurant and branch roles add jobs at specific locations."
      />
      {can("workspace.members.manage") ? (
        <LimitNotice
          workspaceId={workspaceId}
          limitKey="maxStaff"
          scopeNote="Every active member counts as a staff seat, including owners and admins."
        />
      ) : null}
      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="invitations">Invitations</TabsTrigger>
          <TabsTrigger value="roles">Roles</TabsTrigger>
        </TabsList>
        <TabsContent value="members" className="pt-4">
          <MembersTab workspaceId={workspaceId} canManage={can("workspace.members.manage")} />
        </TabsContent>
        <TabsContent value="invitations" className="pt-4">
          <InvitationsTab workspaceId={workspaceId} canManage={can("workspace.members.manage")} />
        </TabsContent>
        <TabsContent value="roles" className="pt-4">
          <RolesTab workspaceId={workspaceId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
