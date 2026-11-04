import { and, desc, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PATCH as patchProfile } from "@/app/api/v1/account/profile/route";
import { GET as me } from "@/app/api/v1/auth/me/route";
import { DELETE as unassignStaffById } from "@/app/api/v1/branches/[branchId]/staff/[assignmentId]/route";
import {
  GET as listStaff,
  POST as assignStaff,
} from "@/app/api/v1/branches/[branchId]/staff/route";
import { POST as acceptInvite } from "@/app/api/v1/invitations/[token]/accept/route";
import { GET as previewInvite } from "@/app/api/v1/invitations/[token]/route";
import { POST as resendInvite } from "@/app/api/v1/workspaces/[workspaceId]/invitations/[invitationId]/resend/route";
import { DELETE as revokeInvite } from "@/app/api/v1/workspaces/[workspaceId]/invitations/[invitationId]/route";
import {
  GET as listInvites,
  POST as invite,
} from "@/app/api/v1/workspaces/[workspaceId]/invitations/route";
import { DELETE as removeAssignment } from "@/app/api/v1/workspaces/[workspaceId]/members/[membershipId]/assignments/[assignmentId]/route";
import { POST as addAssignment } from "@/app/api/v1/workspaces/[workspaceId]/members/[membershipId]/assignments/route";
import {
  DELETE as removeMember,
  PATCH as patchMember,
} from "@/app/api/v1/workspaces/[workspaceId]/members/[membershipId]/route";
import { GET as listMembers } from "@/app/api/v1/workspaces/[workspaceId]/members/route";
import {
  DELETE as deleteRole,
  PATCH as patchRole,
} from "@/app/api/v1/workspaces/[workspaceId]/roles/[roleId]/route";
import {
  GET as listRoles,
  POST as createRole,
} from "@/app/api/v1/workspaces/[workspaceId]/roles/route";
import type {
  AcceptInvitationResultDto,
  AssignmentDto,
  BranchStaffDto,
  CreatedInvitationDto,
  InvitationDto,
  InvitationPreviewDto,
  MemberDto,
  RoleDto,
} from "@/contracts/tenancy";
import {
  emailOutbox,
  notifications,
  roles,
  subscriptionPlans,
  subscriptions,
} from "@/infrastructure/database/providers/postgres/schema";
import type { Container } from "@/server/container";
import {
  addStaffMember,
  createWorkspaceAs,
  insertRestaurantWithBranch,
  signUpUser,
  type TestUser,
} from "@/test/fixtures";
import { call, createTestContainer, uniqueEmail } from "@/test/harness";

let c: Container;
beforeAll(async () => {
  c = await createTestContainer();
});
afterAll(async () => {
  await c.close();
});

async function systemRoleId(key: string) {
  const [row] = await c.db
    .select({ id: roles.id })
    .from(roles)
    .where(and(isNull(roles.workspaceId), eq(roles.key, key)));
  return row!.id;
}

async function members(workspaceId: string, user: TestUser) {
  const res = await call<MemberDto[]>(listMembers, { params: { workspaceId }, cookie: user.cookie });
  return res.body.data!;
}

function tokenFrom(url: string) {
  return url.split("/invite/")[1]!;
}

describe("invitations", () => {
  it("invites by email, previews publicly, emails the link and accepts with a branch role", async () => {
    const owner = await signUpUser("Olivia Owner");
    const ws = await createWorkspaceAs(owner, "Curry House");
    const { restaurantId, branchId } = await insertRestaurantWithBranch(c, ws.id);
    const inviteeEmail = uniqueEmail("waiter");

    const created = await call<CreatedInvitationDto>(invite, {
      params: { workspaceId: ws.id },
      body: {
        email: inviteeEmail.toUpperCase(),
        workspaceRoleId: await systemRoleId("workspace_member"),
        assignmentRoleId: await systemRoleId("waiter"),
        restaurantId,
        branchId,
      },
      cookie: owner.cookie,
    });
    expect(created.status).toBe(201);
    const { invitation, inviteUrl } = created.body.data!;
    expect(invitation.email).toBe(inviteeEmail);
    expect(invitation.assignmentRole?.key).toBe("waiter");
    expect(inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);

    const [mail] = await c.db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.toAddress, inviteeEmail))
      .orderBy(desc(emailOutbox.createdAt));
    expect(mail?.template).toBe("workspace_invitation");
    expect(mail?.textBody).toContain(inviteUrl);

    const dup = await call(invite, {
      params: { workspaceId: ws.id },
      body: { email: inviteeEmail, workspaceRoleId: await systemRoleId("workspace_member") },
      cookie: owner.cookie,
    });
    expect(dup.status).toBe(409);

    const token = tokenFrom(inviteUrl);
    const preview = await call<InvitationPreviewDto>(previewInvite, { params: { token } });
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({
      workspaceName: "Curry House",
      inviterName: "Olivia Owner",
      email: inviteeEmail,
      roleName: "Member",
      assignmentRoleName: "Waiter",
      expired: false,
    });

    const invitee = await signUpUser("Ivan Invitee", inviteeEmail);
    const accepted = await call<AcceptInvitationResultDto>(acceptInvite, {
      method: "POST",
      params: { token },
      cookie: invitee.cookie,
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data).toEqual({ workspaceId: ws.id, branchId });

    const meRes = await call<{ activeWorkspaceId: string }>(me, { cookie: invitee.cookie });
    expect(meRes.body.data!.activeWorkspaceId).toBe(ws.id);

    const list = await members(ws.id, owner);
    const m = list.find((x) => x.userId === invitee.userId)!;
    expect(m.role.key).toBe("workspace_member");
    expect(m.assignments.map((a) => [a.role.key, a.branchId])).toEqual([["waiter", branchId]]);

    const again = await call(acceptInvite, {
      method: "POST",
      params: { token },
      cookie: invitee.cookie,
    });
    expect(again.status).toBe(409);

    const invites = await call<InvitationDto[]>(listInvites, {
      params: { workspaceId: ws.id },
      cookie: owner.cookie,
    });
    expect(invites.body.data!.find((i) => i.id === invitation.id)?.status).toBe("ACCEPTED");
  });

  it("rejects accepting with a different email, and supports resend and revoke", async () => {
    const owner = await signUpUser();
    const ws = await createWorkspaceAs(owner);
    const email = uniqueEmail("target");
    const created = await call<CreatedInvitationDto>(invite, {
      params: { workspaceId: ws.id },
      body: { email, workspaceRoleId: await systemRoleId("workspace_admin") },
      cookie: owner.cookie,
    });
    const firstToken = tokenFrom(created.body.data!.inviteUrl);

    const intruder = await signUpUser("Intruder");
    const wrong = await call(acceptInvite, {
      method: "POST",
      params: { token: firstToken },
      cookie: intruder.cookie,
    });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error!.message).toContain(email);

    const resent = await call<CreatedInvitationDto>(resendInvite, {
      method: "POST",
      params: { workspaceId: ws.id, invitationId: created.body.data!.invitation.id },
      cookie: owner.cookie,
    });
    expect(resent.status).toBe(200);
    const newToken = tokenFrom(resent.body.data!.inviteUrl);
    expect(newToken).not.toBe(firstToken);
    expect((await call(previewInvite, { params: { token: firstToken } })).status).toBe(404);

    const revoked = await call(revokeInvite, {
      method: "DELETE",
      params: { workspaceId: ws.id, invitationId: created.body.data!.invitation.id },
      cookie: owner.cookie,
    });
    expect(revoked.status).toBe(200);
    const preview = await call<InvitationPreviewDto>(previewInvite, { params: { token: newToken } });
    expect(preview.body.data!.status).toBe("REVOKED");

    const target = await signUpUser("Target", email);
    const accept = await call(acceptInvite, {
      method: "POST",
      params: { token: newToken },
      cookie: target.cookie,
    });
    expect(accept.status).toBe(409);
  });

  it("notifies an existing user in-app and only lets owners invite owners", async () => {
    const owner = await signUpUser();
    const admin = await signUpUser("Ada Admin");
    const existing = await signUpUser("Existing User");
    const ws = await createWorkspaceAs(owner);
    await addStaffMember(c, { workspaceId: ws.id, userId: admin.userId, role: "workspace_admin" });

    const asAdminOwner = await call(invite, {
      params: { workspaceId: ws.id },
      body: { email: uniqueEmail(), workspaceRoleId: await systemRoleId("workspace_owner") },
      cookie: admin.cookie,
    });
    expect(asAdminOwner.status).toBe(403);

    const ok = await call(invite, {
      params: { workspaceId: ws.id },
      body: { email: existing.email, workspaceRoleId: await systemRoleId("workspace_member") },
      cookie: admin.cookie,
    });
    expect(ok.status).toBe(201);
    const rows = await c.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, existing.userId));
    expect(rows.map((n) => n.type)).toContain("staff.invited");
  });

  it("enforces maxStaff on invite and accept", async () => {
    const owner = await signUpUser();
    const ws = await createWorkspaceAs(owner);
    const [starter] = await c.db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.key, "starter"));
    const memberRole = await systemRoleId("workspace_member");
    const email = uniqueEmail("late");
    const created = await call<CreatedInvitationDto>(invite, {
      params: { workspaceId: ws.id },
      body: { email, workspaceRoleId: memberRole },
      cookie: owner.cookie,
    });
    expect(created.status).toBe(201);

    // Now the workspace is on a plan with a single seat (the owner).
    await c.db
      .update(subscriptions)
      .set({ planId: starter!.id })
      .where(eq(subscriptions.workspaceId, ws.id));
    await c.db
      .update(subscriptionPlans)
      .set({ limits: { ...starter!.limits, maxStaff: 1 } })
      .where(eq(subscriptionPlans.id, starter!.id));
    try {
      const blocked = await call(invite, {
        params: { workspaceId: ws.id },
        body: { email: uniqueEmail(), workspaceRoleId: memberRole },
        cookie: owner.cookie,
      });
      expect(blocked.status).toBe(402);
      const late = await signUpUser("Late", email);
      const accept = await call(acceptInvite, {
        method: "POST",
        params: { token: tokenFrom(created.body.data!.inviteUrl) },
        cookie: late.cookie,
      });
      expect(accept.status).toBe(402);
      expect(accept.body.error!.code).toBe("LIMIT_REACHED");
    } finally {
      await c.db
        .update(subscriptionPlans)
        .set({ limits: starter!.limits })
        .where(eq(subscriptionPlans.id, starter!.id));
    }
  });

  it("does not expose invitations across workspaces", async () => {
    const a = await signUpUser();
    const b = await signUpUser();
    const wsA = await createWorkspaceAs(a);
    const wsB = await createWorkspaceAs(b);
    const created = await call<CreatedInvitationDto>(invite, {
      params: { workspaceId: wsA.id },
      body: { email: uniqueEmail(), workspaceRoleId: await systemRoleId("workspace_member") },
      cookie: a.cookie,
    });
    const id = created.body.data!.invitation.id;
    expect(
      (await call(listInvites, { params: { workspaceId: wsA.id }, cookie: b.cookie })).status,
    ).toBe(404);
    // B uses their own workspace id with A's invitation id.
    expect(
      (
        await call(revokeInvite, {
          method: "DELETE",
          params: { workspaceId: wsB.id, invitationId: id },
          cookie: b.cookie,
        })
      ).status,
    ).toBe(404);
    const { restaurantId } = await insertRestaurantWithBranch(c, wsA.id);
    const crossTarget = await call(invite, {
      params: { workspaceId: wsB.id },
      body: {
        email: uniqueEmail(),
        workspaceRoleId: await systemRoleId("workspace_member"),
        restaurantId,
        assignmentRoleId: await systemRoleId("waiter"),
      },
      cookie: b.cookie,
    });
    expect(crossTarget.status).toBe(404);
  });
});

describe("members", () => {
  it("protects the last owner and restricts owner changes to owners", async () => {
    const owner = await signUpUser("Only Owner");
    const admin = await signUpUser("Admin");
    const ws = await createWorkspaceAs(owner);
    await addStaffMember(c, { workspaceId: ws.id, userId: admin.userId, role: "workspace_admin" });
    const list = await members(ws.id, owner);
    const ownerM = list.find((m) => m.userId === owner.userId)!;
    const adminM = list.find((m) => m.userId === admin.userId)!;

    const demoteSelf = await call(patchMember, {
      method: "PATCH",
      params: { workspaceId: ws.id, membershipId: ownerM.membershipId },
      body: { roleId: await systemRoleId("workspace_admin") },
      cookie: owner.cookie,
    });
    expect(demoteSelf.status).toBe(409);
    const removeSelf = await call(removeMember, {
      method: "DELETE",
      params: { workspaceId: ws.id, membershipId: ownerM.membershipId },
      cookie: owner.cookie,
    });
    expect(removeSelf.status).toBe(409);
    const disable = await call(patchMember, {
      method: "PATCH",
      params: { workspaceId: ws.id, membershipId: ownerM.membershipId },
      body: { status: "DISABLED" },
      cookie: owner.cookie,
    });
    expect(disable.status).toBe(409);

    // Admins cannot touch owners or promote to owner.
    const adminDemotes = await call(patchMember, {
      method: "PATCH",
      params: { workspaceId: ws.id, membershipId: ownerM.membershipId },
      body: { roleId: await systemRoleId("workspace_member") },
      cookie: admin.cookie,
    });
    expect(adminDemotes.status).toBe(403);
    const adminPromotes = await call(patchMember, {
      method: "PATCH",
      params: { workspaceId: ws.id, membershipId: adminM.membershipId },
      body: { roleId: await systemRoleId("workspace_owner") },
      cookie: admin.cookie,
    });
    expect(adminPromotes.status).toBe(403);

    // Owner promotes admin, then can step down.
    const promote = await call<MemberDto>(patchMember, {
      method: "PATCH",
      params: { workspaceId: ws.id, membershipId: adminM.membershipId },
      body: { roleId: await systemRoleId("workspace_owner") },
      cookie: owner.cookie,
    });
    expect(promote.status).toBe(200);
    expect(promote.body.data!.role.key).toBe("workspace_owner");
    const stepDown = await call<MemberDto>(patchMember, {
      method: "PATCH",
      params: { workspaceId: ws.id, membershipId: ownerM.membershipId },
      body: { roleId: await systemRoleId("workspace_admin") },
      cookie: owner.cookie,
    });
    expect(stepDown.status).toBe(200);
  });

  it("removes members, manages assignments, and blocks non-managers", async () => {
    const owner = await signUpUser();
    const staff = await signUpUser("Kitchen Kim");
    const ws = await createWorkspaceAs(owner);
    const { restaurantId, branchId } = await insertRestaurantWithBranch(c, ws.id);
    await addStaffMember(c, {
      workspaceId: ws.id,
      userId: staff.userId,
      role: "kitchen_staff",
      restaurantId,
      branchId,
    });
    const m = (await members(ws.id, owner)).find((x) => x.userId === staff.userId)!;

    // Staff can't list or manage members.
    expect(
      (await call(listMembers, { params: { workspaceId: ws.id }, cookie: staff.cookie })).status,
    ).toBe(403);
    expect(
      (
        await call(removeMember, {
          method: "DELETE",
          params: { workspaceId: ws.id, membershipId: m.membershipId },
          cookie: staff.cookie,
        })
      ).status,
    ).toBe(403);

    const added = await call<AssignmentDto>(addAssignment, {
      params: { workspaceId: ws.id, membershipId: m.membershipId },
      body: { roleId: await systemRoleId("cashier"), restaurantId, branchId },
      cookie: owner.cookie,
    });
    expect(added.status).toBe(201);
    expect(added.body.data!.role.key).toBe("cashier");

    const wsRoleAsAssignment = await call(addAssignment, {
      params: { workspaceId: ws.id, membershipId: m.membershipId },
      body: { roleId: await systemRoleId("workspace_admin"), restaurantId },
      cookie: owner.cookie,
    });
    expect(wsRoleAsAssignment.status).toBe(422);

    const removed = await call(removeAssignment, {
      method: "DELETE",
      params: {
        workspaceId: ws.id,
        membershipId: m.membershipId,
        assignmentId: added.body.data!.id,
      },
      cookie: owner.cookie,
    });
    expect(removed.status).toBe(200);

    const gone = await call(removeMember, {
      method: "DELETE",
      params: { workspaceId: ws.id, membershipId: m.membershipId },
      cookie: owner.cookie,
    });
    expect(gone.status).toBe(200);
    expect((await members(ws.id, owner)).some((x) => x.userId === staff.userId)).toBe(false);
  });
});

describe("branch staff", () => {
  it("lets a restaurant manager assign and remove branch staff, but not elsewhere", async () => {
    const owner = await signUpUser();
    const manager = await signUpUser("Manny Manager");
    const waiter = await signUpUser("Wendy Waiter");
    const ws = await createWorkspaceAs(owner);
    const main = await insertRestaurantWithBranch(c, ws.id);
    const other = await insertRestaurantWithBranch(c, ws.id, { name: "Elsewhere" });
    await addStaffMember(c, {
      workspaceId: ws.id,
      userId: manager.userId,
      role: "restaurant_manager",
      restaurantId: main.restaurantId,
    });
    await addStaffMember(c, {
      workspaceId: ws.id,
      userId: waiter.userId,
      role: "kitchen_staff",
      restaurantId: other.restaurantId,
      branchId: other.branchId,
    });

    const staff = await call<BranchStaffDto>(listStaff, {
      params: { branchId: main.branchId },
      cookie: manager.cookie,
    });
    expect(staff.status).toBe(200);
    expect(staff.body.data!.roles.every((r) => r.scope !== "WORKSPACE")).toBe(true);
    const candidate = staff.body.data!.candidates.find((x) => x.name === "Wendy Waiter")!;

    const assigned = await call<AssignmentDto>(assignStaff, {
      params: { branchId: main.branchId },
      body: { membershipId: candidate.membershipId, roleId: await systemRoleId("waiter") },
      cookie: manager.cookie,
    });
    expect(assigned.status).toBe(201);
    const after = await call<BranchStaffDto>(listStaff, {
      params: { branchId: main.branchId },
      cookie: manager.cookie,
    });
    expect(after.body.data!.assignments.map((a) => a.name)).toContain("Wendy Waiter");

    // The manager has no rights over the other restaurant's branch.
    expect(
      (await call(listStaff, { params: { branchId: other.branchId }, cookie: manager.cookie }))
        .status,
    ).toBe(404);
    // The waiter (kitchen at other) can't manage staff there.
    expect(
      (await call(listStaff, { params: { branchId: other.branchId }, cookie: waiter.cookie }))
        .status,
    ).toBe(403);

    // Restaurant managers can invite staff to their restaurant (member role only).
    const inv = await call(invite, {
      params: { workspaceId: ws.id },
      body: {
        email: uniqueEmail(),
        workspaceRoleId: staff.body.data!.memberRoleId,
        restaurantId: main.restaurantId,
        branchId: main.branchId,
        assignmentRoleId: await systemRoleId("cashier"),
      },
      cookie: manager.cookie,
    });
    expect(inv.status).toBe(201);
    const invAdmin = await call(invite, {
      params: { workspaceId: ws.id },
      body: { email: uniqueEmail(), workspaceRoleId: await systemRoleId("workspace_admin") },
      cookie: manager.cookie,
    });
    expect(invAdmin.status).toBe(403);

    const removed = await call(unassignStaffById, {
      method: "DELETE",
      params: { branchId: main.branchId, assignmentId: assigned.body.data!.id },
      cookie: manager.cookie,
    });
    expect(removed.status).toBe(200);
  });
});

describe("custom roles", () => {
  it("creates, edits and deletes custom roles; system roles are read-only; in-use roles can't be deleted", async () => {
    const owner = await signUpUser();
    const ws = await createWorkspaceAs(owner);
    const { restaurantId, branchId } = await insertRestaurantWithBranch(c, ws.id);

    const list = await call<RoleDto[]>(listRoles, {
      params: { workspaceId: ws.id },
      cookie: owner.cookie,
    });
    expect(list.body.data!.filter((r) => r.isSystem).length).toBeGreaterThanOrEqual(7);

    const created = await call<RoleDto>(createRole, {
      params: { workspaceId: ws.id },
      body: {
        name: "Floor Lead",
        scope: "BRANCH",
        permissions: ["branch.view", "orders.view", "orders.approve"],
      },
      cookie: owner.cookie,
    });
    expect(created.status).toBe(201);
    const role = created.body.data!;
    expect(role.isSystem).toBe(false);

    const badScope = await call(patchRole, {
      method: "PATCH",
      params: { workspaceId: ws.id, roleId: role.id },
      body: { permissions: ["menu.manage"] },
      cookie: owner.cookie,
    });
    expect(badScope.status).toBe(422);

    const edited = await call<RoleDto>(patchRole, {
      method: "PATCH",
      params: { workspaceId: ws.id, roleId: role.id },
      body: { name: "Floor Captain", permissions: ["branch.view", "orders.view"] },
      cookie: owner.cookie,
    });
    expect(edited.body.data!.name).toBe("Floor Captain");
    expect(edited.body.data!.permissions.sort()).toEqual(["branch.view", "orders.view"]);

    const system = list.body.data!.find((r) => r.key === "waiter")!;
    expect(
      (
        await call(patchRole, {
          method: "PATCH",
          params: { workspaceId: ws.id, roleId: system.id },
          body: { name: "Server" },
          cookie: owner.cookie,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(deleteRole, {
          method: "DELETE",
          params: { workspaceId: ws.id, roleId: system.id },
          cookie: owner.cookie,
        })
      ).status,
    ).toBe(403);

    // In use → conflict.
    const staffUser = await signUpUser();
    await addStaffMember(c, {
      workspaceId: ws.id,
      userId: staffUser.userId,
      role: "waiter",
      restaurantId,
      branchId,
    });
    const m = (await members(ws.id, owner)).find((x) => x.userId === staffUser.userId)!;
    const assigned = await call<AssignmentDto>(addAssignment, {
      params: { workspaceId: ws.id, membershipId: m.membershipId },
      body: { roleId: role.id, restaurantId, branchId },
      cookie: owner.cookie,
    });
    expect(assigned.status).toBe(201);
    const inUse = await call(deleteRole, {
      method: "DELETE",
      params: { workspaceId: ws.id, roleId: role.id },
      cookie: owner.cookie,
    });
    expect(inUse.status).toBe(409);
    await call(removeAssignment, {
      method: "DELETE",
      params: { workspaceId: ws.id, membershipId: m.membershipId, assignmentId: assigned.body.data!.id },
      cookie: owner.cookie,
    });
    const deleted = await call(deleteRole, {
      method: "DELETE",
      params: { workspaceId: ws.id, roleId: role.id },
      cookie: owner.cookie,
    });
    expect(deleted.status).toBe(200);

    // Other workspaces can't see or use the role.
    const stranger = await signUpUser();
    const wsS = await createWorkspaceAs(stranger);
    const again = await call<RoleDto>(createRole, {
      params: { workspaceId: ws.id },
      body: { name: "Private", scope: "BRANCH", permissions: ["branch.view"] },
      cookie: owner.cookie,
    });
    expect(
      (
        await call(patchRole, {
          method: "PATCH",
          params: { workspaceId: wsS.id, roleId: again.body.data!.id },
          body: { name: "Mine" },
          cookie: stranger.cookie,
        })
      ).status,
    ).toBe(404);
  });

  it("requires the custom_roles feature and the roles permission", async () => {
    const owner = await signUpUser();
    const admin = await signUpUser();
    const ws = await createWorkspaceAs(owner);
    await addStaffMember(c, { workspaceId: ws.id, userId: admin.userId, role: "workspace_admin" });
    const body = { name: "Helper", scope: "BRANCH", permissions: ["branch.view"] };
    expect(
      (await call(createRole, { params: { workspaceId: ws.id }, body, cookie: admin.cookie }))
        .status,
    ).toBe(403);
    const [starter] = await c.db
      .select({ id: subscriptionPlans.id })
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.key, "starter"));
    await c.db
      .update(subscriptions)
      .set({ planId: starter!.id })
      .where(eq(subscriptions.workspaceId, ws.id));
    const res = await call(createRole, {
      params: { workspaceId: ws.id },
      body,
      cookie: owner.cookie,
    });
    expect(res.status).toBe(402);
    expect(res.body.error!.code).toBe("ENTITLEMENT_REQUIRED");
  });
});

describe("account profile", () => {
  it("updates the signed-in user's name", async () => {
    const user = await signUpUser("Old Name");
    const res = await call(patchProfile, {
      method: "PATCH",
      body: { name: "New Name" },
      cookie: user.cookie,
    });
    expect(res.status).toBe(200);
    const meRes = await call<{ user: { name: string } }>(me, { cookie: user.cookie });
    expect(meRes.body.data!.user.name).toBe("New Name");
    expect(
      (await call(patchProfile, { method: "PATCH", body: { name: "X" }, cookie: user.cookie }))
        .status,
    ).toBe(422);
  });
});
