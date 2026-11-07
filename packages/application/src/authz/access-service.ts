import { operationKindFor } from "@ros/domain/access/operation-kinds";
import {
  effectivePermissions,
  hasPermission,
  isPermission,
  type AccessGrants,
  type Permission,
} from "@ros/domain/access/permissions";
import { forbidden, isDomainError, notFound } from "@ros/domain/shared/errors";
import { assertOperationAllowed, type Entitlements } from "@ros/domain/subscriptions/entitlements";

import type { UserActor } from "../context";
import { bindWorkspace } from "../db-context";
import type {
  AccessRepository,
  BranchRef,
  MembershipGrants,
  RestaurantRef,
} from "../ports/core-repositories";
import type { EntitlementService } from "../subscriptions/entitlement-service";

/**
 * Tenant authorization. Every protected operation obtains a scope from this
 * service using IDs from the URL/body, which are treated as *requests*: the
 * scope is only returned if the server-side membership grants access. All
 * repository calls afterwards use the scope's IDs, never the raw client IDs.
 *
 * A resource that exists in another workspace is reported as NOT_FOUND (not
 * FORBIDDEN) so IDs cannot be probed across tenants.
 */

export interface WorkspaceScope {
  kind: "workspace";
  workspaceId: string;
  workspaceName: string;
  membershipId: string;
  roleKey: string;
  actor: UserActor;
  grants: AccessGrants;
  entitlements: Entitlements;
  can(permission: Permission, target?: { restaurantId?: string; branchId?: string }): boolean;
  /** Throws FORBIDDEN or WORKSPACE_RESTRICTED. */
  require(permission: Permission, target?: { restaurantId?: string; branchId?: string }): void;
  /**
   * Human-readable role of the user here: the workspace role for owners and
   * admins, otherwise the restaurant/branch roles that apply at `target`.
   */
  roleLabel(target?: { restaurantId?: string; branchId?: string }): string;
  /** Restaurants the user can see (null = all in workspace). */
  visibleRestaurantIds(): string[] | null;
  /**
   * Branch filter for listings: null = every branch of the visible
   * restaurants; otherwise restaurant-wide grants plus explicit branch ids.
   */
  branchFilter(): { restaurantIds: string[]; branchIds: string[] } | null;
}

export interface RestaurantScope extends Omit<WorkspaceScope, "kind"> {
  kind: "restaurant";
  restaurant: RestaurantRef;
  restaurantId: string;
}

export interface BranchScope extends Omit<WorkspaceScope, "kind"> {
  kind: "branch";
  branch: BranchRef;
  restaurantId: string;
  branchId: string;
}

function toGrants(m: MembershipGrants): AccessGrants {
  const toSet = (keys: string[]) => new Set(keys.filter(isPermission));
  const restaurants = new Map<string, Set<Permission>>();
  const branches = new Map<string, Set<Permission>>();
  for (const a of m.assignments) {
    const target = a.branchId ? branches : restaurants;
    const id = a.branchId ?? a.restaurantId;
    const set = target.get(id) ?? new Set<Permission>();
    for (const p of toSet(a.permissions)) set.add(p);
    target.set(id, set);
  }
  return { workspace: toSet(m.workspacePermissions), restaurants, branches };
}

export interface AccessService {
  forWorkspace(actor: UserActor, workspaceId: string): Promise<WorkspaceScope>;
  forRestaurant(actor: UserActor, restaurantId: string): Promise<RestaurantScope>;
  forBranch(actor: UserActor, branchId: string): Promise<BranchScope>;
  requirePlatformAdmin(actor: UserActor): void;
  /** Permissions at a target, for UI display. Never used for enforcement. */
  describe(scope: WorkspaceScope | RestaurantScope | BranchScope): Permission[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createAccessService(deps: {
  repo: AccessRepository;
  entitlements: EntitlementService;
}): AccessService {
  const { repo, entitlements } = deps;

  async function workspaceScope(actor: UserActor, workspaceId: string): Promise<WorkspaceScope> {
    if (!UUID.test(workspaceId)) throw notFound("Workspace");
    const membership = await repo.loadMembershipGrants(actor.userId, workspaceId);
    if (!membership || membership.status !== "ACTIVE") throw notFound("Workspace");
    bindWorkspace(membership.workspaceId);
    const grants = toGrants(membership);
    const ent = await entitlements.getWorkspaceEntitlements(workspaceId);

    const can = (
      permission: Permission,
      target: { restaurantId?: string; branchId?: string } = {},
    ) => hasPermission(grants, permission, target);

    // Every assignment (restaurant-wide or branch) carries its restaurant id.
    const restaurantIds = new Set(membership.assignments.map((a) => a.restaurantId));
    const restaurantWide = membership.assignments
      .filter((a) => !a.branchId)
      .map((a) => a.restaurantId);
    const branchIds = membership.assignments.filter((a) => a.branchId).map((a) => a.branchId!);
    const workspaceWide =
      grants.workspace.has("restaurant.view") && grants.workspace.has("branch.view");

    return {
      kind: "workspace",
      workspaceId: membership.workspaceId,
      workspaceName: membership.workspaceName,
      membershipId: membership.membershipId,
      roleKey: membership.roleKey,
      actor,
      grants,
      entitlements: ent,
      can,
      require(permission, target) {
        if (!can(permission, target)) throw forbidden();
        assertOperationAllowed(ent, operationKindFor(permission));
      },
      roleLabel(target = {}) {
        if (membership.roleKey === "workspace_owner" || membership.roleKey === "workspace_admin") {
          return membership.roleName;
        }
        const names = membership.assignments
          .filter(
            (a) =>
              (!target.restaurantId || a.restaurantId === target.restaurantId) &&
              (!target.branchId || a.branchId === null || a.branchId === target.branchId),
          )
          .map((a) => a.roleName);
        const unique = [...new Set(names)];
        return unique.length > 0 ? unique.join(", ") : membership.roleName;
      },
      visibleRestaurantIds: () => (workspaceWide ? null : [...restaurantIds]),
      branchFilter: () =>
        workspaceWide
          ? null
          : { restaurantIds: [...new Set(restaurantWide)], branchIds: [...new Set(branchIds)] },
    };
  }

  return {
    forWorkspace: workspaceScope,

    async forRestaurant(actor, restaurantId) {
      if (!UUID.test(restaurantId)) throw notFound("Restaurant");
      const restaurant = await repo.findRestaurantRef(restaurantId);
      if (!restaurant) throw notFound("Restaurant");
      let ws: WorkspaceScope;
      try {
        ws = await workspaceScope(actor, restaurant.workspaceId);
      } catch (error) {
        if (isDomainError(error) && error.code === "NOT_FOUND") throw notFound("Restaurant");
        throw error;
      }
      const visible = ws.visibleRestaurantIds();
      if (visible !== null && !visible.includes(restaurant.id)) throw notFound("Restaurant");
      return {
        ...ws,
        kind: "restaurant",
        restaurant,
        restaurantId: restaurant.id,
        can: (p, t) => ws.can(p, { restaurantId: restaurant.id, ...t }),
        require: (p, t) => ws.require(p, { restaurantId: restaurant.id, ...t }),
      };
    },

    async forBranch(actor, branchId) {
      if (!UUID.test(branchId)) throw notFound("Branch");
      const branch = await repo.findBranchRef(branchId);
      if (!branch) throw notFound("Branch");
      let ws: WorkspaceScope;
      try {
        ws = await workspaceScope(actor, branch.workspaceId);
      } catch (error) {
        if (isDomainError(error) && error.code === "NOT_FOUND") throw notFound("Branch");
        throw error;
      }
      const target = { restaurantId: branch.restaurantId, branchId: branch.id };
      if (!ws.can("branch.view", target)) throw notFound("Branch");
      return {
        ...ws,
        kind: "branch",
        branch,
        restaurantId: branch.restaurantId,
        branchId: branch.id,
        can: (p, t) => ws.can(p, { ...target, ...t }),
        require: (p, t) => ws.require(p, { ...target, ...t }),
      };
    },

    requirePlatformAdmin(actor) {
      if (!actor.isPlatformAdmin) throw forbidden("Super Admin access required");
    },

    describe(scope) {
      if (scope.kind === "branch") {
        return effectivePermissions(scope.grants, {
          restaurantId: scope.restaurantId,
          branchId: scope.branchId,
        });
      }
      if (scope.kind === "restaurant") {
        return effectivePermissions(scope.grants, { restaurantId: scope.restaurantId });
      }
      return effectivePermissions(scope.grants);
    },
  };
}
