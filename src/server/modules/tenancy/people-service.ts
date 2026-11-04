import type { z } from "zod";

import type {
  AcceptInvitationResultDto,
  AssignmentDto,
  BranchStaffDto,
  CreatedInvitationDto,
  createInvitationSchema,
  createRoleSchema,
  InvitationDto,
  InvitationPreviewDto,
  MemberDto,
  RoleDto,
  updateRoleSchema,
} from "@/contracts/tenancy";
import { allowedPermissionsForScope } from "@/contracts/tenancy";
import {
  conflict,
  DomainError,
  forbidden,
  notFound,
  validationFailed,
} from "@/domain/shared/errors";
import { generateToken, hashToken, isWellFormedToken } from "@/domain/shared/tokens";
import { addDays } from "@/domain/subscriptions/entitlements";
import { UniqueViolationError } from "@/infrastructure/database/interfaces/transaction";

import { recordAudit } from "../../audit/audit-service";
import type { BranchScope, WorkspaceScope } from "../../authz/access-service";
import { auditActorFor, type RequestMeta, type UserActor } from "../../context";
import type { TenancyServiceDeps } from "./deps";
import type { RoleRecord, TenancyRepos } from "./ports";
import {
  customRoleKey,
  INVITATION_TTL_DAYS,
  lastOwnerViolation,
  MEMBER_ROLE_KEY,
  OWNER_ROLE_KEY,
  type OwnerChange,
} from "./rules";

type CreateInvitation = z.output<typeof createInvitationSchema>;
type CreateRole = z.output<typeof createRoleSchema>;
type UpdateRole = z.output<typeof updateRoleSchema>;

const isOwner = (scope: WorkspaceScope) => scope.roleKey === OWNER_ROLE_KEY;

/** Checks that a role assignment targets a live restaurant/branch of this workspace. */
async function validateAssignmentTarget(
  r: TenancyRepos,
  workspaceId: string,
  input: { roleId: string; restaurantId: string; branchId: string | null },
): Promise<RoleRecord> {
  const role = await r.tenancy.findRole(workspaceId, input.roleId);
  if (!role || role.scope === "WORKSPACE") {
    throw validationFailed("Choose a restaurant or branch role", {
      roleId: ["Choose a restaurant or branch role"],
    });
  }
  const restaurant = await r.tenancy.findRestaurant(workspaceId, input.restaurantId);
  if (!restaurant) throw notFound("Restaurant");
  if (input.branchId) {
    const branch = await r.tenancy.findBranch(workspaceId, input.branchId);
    if (!branch || branch.restaurantId !== restaurant.id) throw notFound("Branch");
  }
  return role;
}

export function createPeopleService({
  tx,
  clock,
  entitlements,
  sendEmail,
  invitationEmail,
  appUrl,
}: TenancyServiceDeps) {
  const inviteUrl = (token: string) => `${appUrl.replace(/\/$/, "")}/invite/${token}`;

  /** Only owners may grant the owner role or change an owner's membership. */
  function assertOwnerRules(
    scope: WorkspaceScope,
    target: { roleKey: string } | null,
    newRole: RoleRecord | null,
  ) {
    if (newRole?.key === OWNER_ROLE_KEY && !isOwner(scope)) {
      throw forbidden("Only workspace owners can make someone an owner");
    }
    if (target?.roleKey === OWNER_ROLE_KEY && !isOwner(scope)) {
      throw forbidden("Only workspace owners can change another owner");
    }
  }

  async function assertKeepsAnOwner(
    r: TenancyRepos,
    workspaceId: string,
    target: { id: string; roleKey: string; status: string },
    change: OwnerChange | null,
  ) {
    const targetIsActiveOwner = target.roleKey === OWNER_ROLE_KEY && target.status === "ACTIVE";
    if (!targetIsActiveOwner || !change) return;
    const owners = await r.tenancy.lockActiveOwners(workspaceId);
    const message = lastOwnerViolation({
      targetIsActiveOwner,
      change,
      activeOwnerCount: owners.length,
    });
    if (message) throw conflict(message);
  }

  /** Invitations: workspace managers, or restaurant staff managers inviting staff to their restaurant. */
  function assertCanInvite(
    scope: WorkspaceScope,
    input: { restaurantId: string | null; assignmentRoleId: string | null },
    workspaceRole: RoleRecord,
  ) {
    if (scope.can("workspace.members.manage")) {
      scope.require("workspace.members.manage");
      return;
    }
    if (
      input.restaurantId &&
      input.assignmentRoleId &&
      workspaceRole.key === MEMBER_ROLE_KEY &&
      scope.can("staff.manage", { restaurantId: input.restaurantId })
    ) {
      scope.require("staff.manage", { restaurantId: input.restaurantId });
      return;
    }
    throw forbidden();
  }

  async function issueInvitationEmail(
    workspaceName: string,
    inviterName: string,
    email: string,
    token: string,
  ) {
    await sendEmail({
      to: email,
      ...invitationEmail(workspaceName, inviterName, inviteUrl(token)),
    });
  }

  return {
    // ---------------------------------------------------------------- members
    async listMembers(scope: WorkspaceScope): Promise<MemberDto[]> {
      scope.require("workspace.members.view");
      return tx.read((r) => r.tenancy.listMembers(scope.workspaceId));
    },

    async updateMember(
      scope: WorkspaceScope,
      membershipId: string,
      input: { roleId?: string; status?: "ACTIVE" | "DISABLED" },
      meta: RequestMeta,
    ): Promise<MemberDto> {
      scope.require("workspace.members.manage");
      const target = await tx.read((r) =>
        r.tenancy.findMembership(scope.workspaceId, membershipId),
      );
      if (!target) throw notFound("Member");
      if (input.status === "ACTIVE" && target.status === "DISABLED") {
        await entitlements.assertCanAdd(scope.workspaceId, "maxStaff");
      }
      return tx.run(async (r) => {
        let newRole: RoleRecord | null = null;
        if (input.roleId && input.roleId !== target.roleId) {
          newRole = await r.tenancy.findRole(scope.workspaceId, input.roleId);
          if (!newRole || newRole.scope !== "WORKSPACE") {
            throw validationFailed("Choose a workspace role", {
              roleId: ["Choose a workspace role"],
            });
          }
        }
        assertOwnerRules(scope, target, newRole);
        const demote = newRole !== null && newRole.key !== OWNER_ROLE_KEY;
        const disable = input.status === "DISABLED" && target.status === "ACTIVE";
        await assertKeepsAnOwner(
          r,
          scope.workspaceId,
          target,
          disable ? "disable" : demote ? "demote" : null,
        );
        await r.tenancy.updateMembership(scope.workspaceId, membershipId, {
          ...(newRole ? { roleId: newRole.id } : {}),
          ...(input.status && input.status !== target.status ? { status: input.status } : {}),
        });
        const actor = auditActorFor(scope.actor, meta);
        const target_ = {
          workspaceId: scope.workspaceId,
          targetType: "membership",
          targetId: membershipId,
        };
        if (newRole) {
          await recordAudit(r.audit, actor, "member.role_changed", target_, {
            userId: target.userId,
            from: target.roleKey,
            to: newRole.key,
          });
        }
        if (input.status && input.status !== target.status) {
          await recordAudit(r.audit, actor, "member.status_changed", target_, {
            userId: target.userId,
            from: target.status,
            to: input.status,
          });
        }
        const member = await r.tenancy.findMember(scope.workspaceId, membershipId);
        if (!member) throw notFound("Member");
        return member;
      });
    },

    async removeMember(scope: WorkspaceScope, membershipId: string, meta: RequestMeta) {
      scope.require("workspace.members.manage");
      await tx.run(async (r) => {
        const target = await r.tenancy.findMembership(scope.workspaceId, membershipId);
        if (!target) throw notFound("Member");
        assertOwnerRules(scope, target, null);
        await assertKeepsAnOwner(r, scope.workspaceId, target, "remove");
        await r.tenancy.deleteMembership(scope.workspaceId, membershipId);
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "member.removed",
          { workspaceId: scope.workspaceId, targetType: "membership", targetId: membershipId },
          { userId: target.userId, role: target.roleKey },
        );
      });
    },

    // ---------------------------------------------------------------- assignments
    async addAssignment(
      scope: WorkspaceScope,
      membershipId: string,
      input: { roleId: string; restaurantId: string; branchId: string | null },
      meta: RequestMeta,
    ): Promise<AssignmentDto> {
      if (!scope.can("workspace.members.manage")) {
        scope.require("staff.manage", { restaurantId: input.restaurantId });
      } else {
        scope.require("workspace.members.manage");
      }
      return tx.run(async (r) => {
        const member = await r.tenancy.findMembership(scope.workspaceId, membershipId);
        if (!member) throw notFound("Member");
        await validateAssignmentTarget(r, scope.workspaceId, input);
        const created = await r.tenancy.insertAssignment({
          workspaceId: scope.workspaceId,
          membershipId,
          roleId: input.roleId,
          restaurantId: input.restaurantId,
          branchId: input.branchId,
          createdBy: scope.actor.userId,
        });
        if (!created) throw conflict("This member already has that role there");
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "assignment.created",
          {
            workspaceId: scope.workspaceId,
            branchId: input.branchId,
            targetType: "role_assignment",
            targetId: created.id,
          },
          {
            membershipId,
            role: created.role.key,
            restaurantId: input.restaurantId,
            branchId: input.branchId,
          },
        );
        return created;
      });
    },

    async removeAssignment(
      scope: WorkspaceScope,
      membershipId: string,
      assignmentId: string,
      meta: RequestMeta,
    ): Promise<void> {
      const found = await tx.read((r) => r.tenancy.findAssignment(scope.workspaceId, assignmentId));
      if (!found || found.membershipId !== membershipId) throw notFound("Assignment");
      if (!scope.can("workspace.members.manage")) {
        scope.require("staff.manage", { restaurantId: found.restaurantId });
      } else {
        scope.require("workspace.members.manage");
      }
      await tx.run(async (r) => {
        const ok = await r.tenancy.deleteAssignment(scope.workspaceId, assignmentId);
        if (!ok) throw notFound("Assignment");
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "assignment.removed",
          {
            workspaceId: scope.workspaceId,
            branchId: found.branchId,
            targetType: "role_assignment",
            targetId: assignmentId,
          },
          { membershipId, restaurantId: found.restaurantId, branchId: found.branchId },
        );
      });
    },

    // ---------------------------------------------------------------- branch staff
    async listBranchStaff(scope: BranchScope): Promise<BranchStaffDto> {
      scope.require("staff.manage");
      return tx.read(async (r) => {
        const [assignments, candidates, roles, memberRole] = await Promise.all([
          r.tenancy.listBranchAssignments(scope.workspaceId, scope.restaurantId, scope.branchId),
          r.tenancy.listActiveMemberOptions(scope.workspaceId),
          r.tenancy.listRoles(scope.workspaceId),
          r.tenancy.findSystemRole(MEMBER_ROLE_KEY),
        ]);
        return {
          assignments,
          candidates,
          roles: roles
            .filter((role) => role.scope !== "WORKSPACE")
            .map(({ id, key, name, scope: s }) => ({ id, key, name, scope: s })),
          memberRoleId: memberRole.id,
        };
      });
    },

    async assignBranchStaff(
      scope: BranchScope,
      input: { membershipId: string; roleId: string; restaurantWide: boolean },
      meta: RequestMeta,
    ): Promise<AssignmentDto> {
      scope.require("staff.manage");
      const branchId = input.restaurantWide ? null : scope.branchId;
      return tx.run(async (r) => {
        const member = await r.tenancy.findMembership(scope.workspaceId, input.membershipId);
        if (!member) throw notFound("Member");
        if (member.status !== "ACTIVE") throw conflict("This member is disabled");
        await validateAssignmentTarget(r, scope.workspaceId, {
          roleId: input.roleId,
          restaurantId: scope.restaurantId,
          branchId,
        });
        const created = await r.tenancy.insertAssignment({
          workspaceId: scope.workspaceId,
          membershipId: input.membershipId,
          roleId: input.roleId,
          restaurantId: scope.restaurantId,
          branchId,
          createdBy: scope.actor.userId,
        });
        if (!created) throw conflict("This member already has that role here");
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "assignment.created",
          {
            workspaceId: scope.workspaceId,
            branchId: scope.branchId,
            targetType: "role_assignment",
            targetId: created.id,
          },
          {
            membershipId: input.membershipId,
            role: created.role.key,
            restaurantId: scope.restaurantId,
            branchId,
          },
        );
        return created;
      });
    },

    async removeBranchStaff(scope: BranchScope, assignmentId: string, meta: RequestMeta) {
      scope.require("staff.manage");
      await tx.run(async (r) => {
        const found = await r.tenancy.findAssignment(scope.workspaceId, assignmentId);
        const visibleHere =
          found &&
          found.restaurantId === scope.restaurantId &&
          (found.branchId === null || found.branchId === scope.branchId);
        if (!found || !visibleHere) throw notFound("Assignment");
        await r.tenancy.deleteAssignment(scope.workspaceId, assignmentId);
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "assignment.removed",
          {
            workspaceId: scope.workspaceId,
            branchId: scope.branchId,
            targetType: "role_assignment",
            targetId: assignmentId,
          },
          {
            membershipId: found.membershipId,
            restaurantId: found.restaurantId,
            branchId: found.branchId,
          },
        );
      });
    },

    // ---------------------------------------------------------------- invitations
    async listInvitations(scope: WorkspaceScope): Promise<InvitationDto[]> {
      scope.require("workspace.members.view");
      return tx.read((r) => r.tenancy.listInvitations(scope.workspaceId, clock.now()));
    },

    async createInvitation(
      scope: WorkspaceScope,
      input: CreateInvitation,
      meta: RequestMeta,
    ): Promise<CreatedInvitationDto> {
      const restaurantId = input.restaurantId ?? null;
      const branchId = input.branchId ?? null;
      const assignmentRoleId = restaurantId ? (input.assignmentRoleId ?? null) : null;
      const workspaceRole = await tx.read((r) =>
        r.tenancy.findRole(scope.workspaceId, input.workspaceRoleId),
      );
      if (!workspaceRole || workspaceRole.scope !== "WORKSPACE") {
        throw validationFailed("Choose a workspace role", {
          workspaceRoleId: ["Choose a workspace role"],
        });
      }
      assertCanInvite(scope, { restaurantId, assignmentRoleId }, workspaceRole);
      assertOwnerRules(scope, null, workspaceRole);
      await entitlements.assertCanAdd(scope.workspaceId, "maxStaff");

      const token = generateToken();
      const tokenHash = await hashToken(token);
      const now = clock.now();
      const expiresAt = addDays(now, INVITATION_TTL_DAYS);
      const inviterName = scope.actor.name;

      let created: { invitation: InvitationDto; workspaceName: string };
      try {
        created = await tx.run(async (r) => {
          const ws = await r.tenancy.findWorkspace(scope.workspaceId);
          if (!ws) throw notFound("Workspace");
          if (assignmentRoleId && restaurantId) {
            await validateAssignmentTarget(r, scope.workspaceId, {
              roleId: assignmentRoleId,
              restaurantId,
              branchId,
            });
          }
          if (await r.tenancy.isActiveMemberEmail(scope.workspaceId, input.email)) {
            throw new DomainError("CONFLICT", "This person is already a member of the workspace", {
              fieldErrors: { email: ["Already a member — assign them a role instead"] },
            });
          }
          const pending = await r.tenancy.findPendingInvitationByEmail(
            scope.workspaceId,
            input.email,
          );
          if (pending) {
            if (pending.expiresAt.getTime() > now.getTime()) {
              throw new DomainError("CONFLICT", "An invitation for this email is already pending", {
                fieldErrors: { email: ["Already invited — resend the pending invitation instead"] },
              });
            }
            await r.tenancy.transitionInvitation(scope.workspaceId, pending.id, "EXPIRED");
          }
          const id = await r.tenancy.insertInvitation({
            workspaceId: scope.workspaceId,
            workspaceName: ws.name,
            inviterName,
            email: input.email,
            tokenHash,
            workspaceRoleId: workspaceRole.id,
            assignmentRoleId,
            restaurantId,
            branchId,
            invitedBy: scope.actor.userId,
            expiresAt,
          });
          await recordAudit(
            r.audit,
            auditActorFor(scope.actor, meta),
            "invitation.created",
            {
              workspaceId: scope.workspaceId,
              branchId,
              targetType: "invitation",
              targetId: id,
            },
            { role: workspaceRole.key, restaurantId, branchId, assignmentRoleId },
          );
          const invitation = await r.tenancy.findInvitationDto(scope.workspaceId, id, now);
          return { invitation: invitation!, workspaceName: ws.name };
        });
      } catch (error) {
        if (error instanceof UniqueViolationError) {
          throw new DomainError("CONFLICT", "An invitation for this email is already pending", {
            fieldErrors: { email: ["Already invited — resend the pending invitation instead"] },
          });
        }
        throw error;
      }
      await issueInvitationEmail(created.workspaceName, inviterName, input.email, token);
      return { invitation: created.invitation, inviteUrl: inviteUrl(token) };
    },

    async resendInvitation(
      scope: WorkspaceScope,
      invitationId: string,
      meta: RequestMeta,
    ): Promise<CreatedInvitationDto> {
      const token = generateToken();
      const tokenHash = await hashToken(token);
      const now = clock.now();
      const result = await tx.run(async (r) => {
        const inv = await r.tenancy.findInvitation(scope.workspaceId, invitationId);
        if (!inv) throw notFound("Invitation");
        const workspaceRole = await r.tenancy.findRole(scope.workspaceId, inv.workspaceRoleId);
        if (!workspaceRole) throw notFound("Invitation");
        assertCanInvite(scope, inv, workspaceRole);
        if (inv.status !== "PENDING") throw conflict("Only pending invitations can be resent");
        await r.tenancy.rotateInvitationToken(
          scope.workspaceId,
          invitationId,
          tokenHash,
          addDays(now, INVITATION_TTL_DAYS),
        );
        const ws = await r.tenancy.findWorkspace(scope.workspaceId);
        await recordAudit(r.audit, auditActorFor(scope.actor, meta), "invitation.resent", {
          workspaceId: scope.workspaceId,
          targetType: "invitation",
          targetId: invitationId,
        });
        const invitation = await r.tenancy.findInvitationDto(scope.workspaceId, invitationId, now);
        return { invitation: invitation!, workspaceName: ws?.name ?? scope.workspaceName };
      });
      await issueInvitationEmail(
        result.workspaceName,
        scope.actor.name,
        result.invitation.email,
        token,
      );
      return { invitation: result.invitation, inviteUrl: inviteUrl(token) };
    },

    async revokeInvitation(scope: WorkspaceScope, invitationId: string, meta: RequestMeta) {
      await tx.run(async (r) => {
        const inv = await r.tenancy.findInvitation(scope.workspaceId, invitationId);
        if (!inv) throw notFound("Invitation");
        const workspaceRole = await r.tenancy.findRole(scope.workspaceId, inv.workspaceRoleId);
        if (!workspaceRole) throw notFound("Invitation");
        assertCanInvite(scope, inv, workspaceRole);
        const ok = await r.tenancy.transitionInvitation(scope.workspaceId, invitationId, "REVOKED");
        if (!ok) throw conflict("Only pending invitations can be revoked");
        await recordAudit(r.audit, auditActorFor(scope.actor, meta), "invitation.revoked", {
          workspaceId: scope.workspaceId,
          targetType: "invitation",
          targetId: invitationId,
        });
      });
    },

    /** Public preview: only what the invitee needs to decide. */
    async previewInvitation(token: string): Promise<InvitationPreviewDto> {
      if (!isWellFormedToken(token)) throw notFound("Invitation");
      const inv = await tx.read(async (r) =>
        r.tenancy.findInvitationByTokenHash(await hashToken(token)),
      );
      if (!inv) throw notFound("Invitation");
      const expired =
        inv.status === "EXPIRED" ||
        (inv.status === "PENDING" && inv.expiresAt.getTime() <= clock.now().getTime());
      return {
        workspaceName: inv.workspaceName,
        inviterName: inv.inviterName,
        email: inv.email,
        roleName: inv.roleName,
        assignmentRoleName: inv.assignmentRoleName,
        restaurantName: inv.restaurantName,
        branchName: inv.branchName,
        status: inv.status,
        expired,
        expiresAt: inv.expiresAt.toISOString(),
      };
    },

    async acceptInvitation(
      actor: UserActor,
      token: string,
      meta: RequestMeta,
    ): Promise<AcceptInvitationResultDto> {
      if (!isWellFormedToken(token)) throw notFound("Invitation");
      const tokenHash = await hashToken(token);
      const now = clock.now();
      // Seat check first (the entitlement service reads outside this module's transaction).
      const pre = await tx.read(async (r) => {
        const found = await r.tenancy.findInvitationByTokenHash(tokenHash);
        return found
          ? {
              inv: found,
              existing: await r.tenancy.findMembershipByUser(found.workspaceId, actor.userId),
            }
          : null;
      });
      if (
        pre &&
        pre.inv.status === "PENDING" &&
        pre.inv.email.toLowerCase() === actor.email.trim().toLowerCase() &&
        (!pre.existing || pre.existing.status === "DISABLED")
      ) {
        await entitlements.assertCanAdd(pre.inv.workspaceId, "maxStaff");
      }
      return tx.run(async (r) => {
        const inv = await r.tenancy.findInvitationByTokenHash(tokenHash, true);
        if (!inv) throw notFound("Invitation");
        if (inv.status === "ACCEPTED") throw conflict("This invitation has already been accepted");
        if (inv.status === "REVOKED") throw conflict("This invitation was revoked");
        if (inv.status === "EXPIRED" || inv.expiresAt.getTime() <= now.getTime()) {
          throw conflict("This invitation has expired. Ask for a new one.");
        }
        if (inv.email.toLowerCase() !== actor.email.trim().toLowerCase()) {
          throw forbidden(
            `This invitation was sent to ${inv.email}. Sign in with that email address to accept it.`,
          );
        }

        const existing = await r.tenancy.findMembershipByUser(inv.workspaceId, actor.userId);
        let membershipId: string;
        if (!existing) {
          membershipId = await r.tenancy.insertMembership({
            workspaceId: inv.workspaceId,
            userId: actor.userId,
            roleId: inv.workspaceRoleId,
            invitedBy: null,
          });
        } else {
          membershipId = existing.id;
          if (existing.status === "DISABLED") {
            await r.tenancy.updateMembership(inv.workspaceId, existing.id, {
              status: "ACTIVE",
              roleId: existing.roleKey === OWNER_ROLE_KEY ? existing.roleId : inv.workspaceRoleId,
            });
          }
        }

        let landingBranchId: string | null = null;
        if (inv.assignmentRoleId && inv.restaurantId) {
          const restaurant = await r.tenancy.findRestaurant(inv.workspaceId, inv.restaurantId);
          const branch = inv.branchId
            ? await r.tenancy.findBranch(inv.workspaceId, inv.branchId)
            : null;
          // Skip the assignment if its target was archived since the invitation was sent.
          if (restaurant && (!inv.branchId || branch)) {
            await r.tenancy.insertAssignment({
              workspaceId: inv.workspaceId,
              membershipId,
              roleId: inv.assignmentRoleId,
              restaurantId: inv.restaurantId,
              branchId: inv.branchId,
              createdBy: null,
            });
            landingBranchId = branch?.id ?? null;
          }
        }

        const ok = await r.tenancy.transitionInvitation(inv.workspaceId, inv.id, "ACCEPTED", {
          acceptedAt: now,
          acceptedBy: actor.userId,
        });
        if (!ok) throw conflict("This invitation is no longer pending");
        await recordAudit(
          r.audit,
          auditActorFor(actor, meta),
          "invitation.accepted",
          {
            workspaceId: inv.workspaceId,
            branchId: inv.branchId,
            targetType: "invitation",
            targetId: inv.id,
          },
          { membershipId, reusedMembership: Boolean(existing) },
        );
        return { workspaceId: inv.workspaceId, branchId: landingBranchId };
      });
    },

    // ---------------------------------------------------------------- roles
    async listRoles(scope: WorkspaceScope): Promise<RoleDto[]> {
      scope.require("workspace.members.view");
      return tx.read((r) => r.tenancy.listRoles(scope.workspaceId));
    },

    async createRole(
      scope: WorkspaceScope,
      input: CreateRole,
      meta: RequestMeta,
    ): Promise<RoleDto> {
      scope.require("workspace.roles.manage");
      await entitlements.assertFeature(scope.workspaceId, "custom_roles");
      return tx.run(async (r) => {
        let key = customRoleKey(input.name, Math.random().toString(36).slice(2, 7));
        for (let i = 0; await r.tenancy.roleKeyExists(scope.workspaceId, key); i++) {
          if (i > 5) throw conflict("Could not create the role; try another name");
          key = customRoleKey(input.name, Math.random().toString(36).slice(2, 7));
        }
        const id = await r.tenancy.insertRole(scope.workspaceId, {
          key,
          name: input.name,
          description: input.description ?? null,
          scope: input.scope,
          permissions: input.permissions,
        });
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "role.created",
          { workspaceId: scope.workspaceId, targetType: "role", targetId: id },
          { name: input.name, scope: input.scope, permissions: input.permissions },
        );
        return (await r.tenancy.findRoleDto(scope.workspaceId, id))!;
      });
    },

    async updateRole(
      scope: WorkspaceScope,
      roleId: string,
      input: UpdateRole,
      meta: RequestMeta,
    ): Promise<RoleDto> {
      scope.require("workspace.roles.manage");
      await entitlements.assertFeature(scope.workspaceId, "custom_roles");
      return tx.run(async (r) => {
        const role = await r.tenancy.findRole(scope.workspaceId, roleId);
        if (!role) throw notFound("Role");
        if (role.isSystem || role.workspaceId === null) {
          throw forbidden("System roles can't be changed. Create a custom role instead.");
        }
        if (input.permissions) {
          const allowed = new Set<string>(allowedPermissionsForScope(role.scope));
          const bad = input.permissions.filter((p) => !allowed.has(p));
          if (bad.length) {
            throw validationFailed("Some permissions don't fit this role's scope", {
              permissions: [`Not allowed for this role: ${bad.join(", ")}`],
            });
          }
        }
        await r.tenancy.updateRole(scope.workspaceId, roleId, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.permissions ? { permissions: input.permissions } : {}),
        });
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "role.updated",
          { workspaceId: scope.workspaceId, targetType: "role", targetId: roleId },
          { fields: Object.keys(input), permissions: input.permissions ?? null },
        );
        return (await r.tenancy.findRoleDto(scope.workspaceId, roleId))!;
      });
    },

    async deleteRole(scope: WorkspaceScope, roleId: string, meta: RequestMeta): Promise<void> {
      scope.require("workspace.roles.manage");
      await entitlements.assertFeature(scope.workspaceId, "custom_roles");
      await tx.run(async (r) => {
        const role = await r.tenancy.findRole(scope.workspaceId, roleId);
        if (!role) throw notFound("Role");
        if (role.isSystem || role.workspaceId === null) {
          throw forbidden("System roles can't be deleted");
        }
        const used = await r.tenancy.roleUsageCount(scope.workspaceId, roleId);
        if (used > 0) {
          throw conflict(
            "This role is still assigned to members or invitations. Reassign them first.",
          );
        }
        await r.tenancy.deleteRole(scope.workspaceId, roleId);
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "role.deleted",
          { workspaceId: scope.workspaceId, targetType: "role", targetId: roleId },
          { name: role.name },
        );
      });
    },

    // ---------------------------------------------------------------- account
    async updateProfile(actor: UserActor, input: { name: string }, meta: RequestMeta) {
      await tx.run(async (r) => {
        await r.tenancy.updateUserName(actor.userId, input.name);
        await recordAudit(
          r.audit,
          auditActorFor(actor, meta),
          "user.profile_updated",
          { workspaceId: null, targetType: "user", targetId: actor.userId },
          { fields: ["name"] },
        );
      });
      return { id: actor.userId, name: input.name, email: actor.email };
    },
  };
}
