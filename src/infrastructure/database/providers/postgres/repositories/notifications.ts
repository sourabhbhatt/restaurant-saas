import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import type { Permission } from "@/domain/access/permissions";
import type { Executor } from "../client";
import {
  notificationPreferences,
  notifications,
  roleAssignments,
  rolePermissions,
  workspaceMemberships,
} from "../schema";

/**
 * In-app notification fan-out (Postgres implementation). Module repositories
 * call these inside their transaction. Notifications are written in the caller's
 * transaction (pass the transaction executor) so they exist only if the
 * change committed. Push/email delivery and realtime signals are separate,
 * best-effort side channels; the app never depends on them.
 */

import type { NotificationInput } from "@/contracts/notifications";

/** Users holding `permission` at a branch (workspace role, restaurant grant or branch grant). */
export async function usersWithPermissionAtBranch(
  db: Executor,
  target: { workspaceId: string; restaurantId: string; branchId: string },
  permission: Permission,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: workspaceMemberships.userId })
    .from(workspaceMemberships)
    .leftJoin(roleAssignments, eq(roleAssignments.membershipId, workspaceMemberships.id))
    .innerJoin(
      rolePermissions,
      or(
        eq(rolePermissions.roleId, workspaceMemberships.roleId),
        and(
          eq(rolePermissions.roleId, roleAssignments.roleId),
          eq(roleAssignments.restaurantId, target.restaurantId),
          or(isNull(roleAssignments.branchId), eq(roleAssignments.branchId, target.branchId)),
        ),
      ),
    )
    .where(
      and(
        eq(workspaceMemberships.workspaceId, target.workspaceId),
        eq(workspaceMemberships.status, "ACTIVE"),
        eq(rolePermissions.permissionKey, permission),
      ),
    );
  return rows.map((r) => r.userId);
}

/** Insert notifications for users, honouring per-user in-app preferences. */
export async function notifyUsers(
  db: Executor,
  userIds: readonly string[],
  scope: { workspaceId: string | null; branchId?: string | null },
  input: NotificationInput,
): Promise<number> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return 0;
  const optedOut = await db
    .select({ userId: notificationPreferences.userId })
    .from(notificationPreferences)
    .where(
      and(
        inArray(notificationPreferences.userId, unique),
        eq(notificationPreferences.type, input.type),
        eq(notificationPreferences.inApp, false),
      ),
    );
  const skip = new Set(optedOut.map((r) => r.userId));
  const rows = unique
    .filter((id) => !skip.has(id))
    .map((userId) => ({
      userId,
      workspaceId: scope.workspaceId,
      branchId: scope.branchId ?? null,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      data: input.data ?? {},
    }));
  if (rows.length) await db.insert(notifications).values(rows);
  return rows.length;
}

export async function notifyBranchStaff(
  db: Executor,
  target: { workspaceId: string; restaurantId: string; branchId: string },
  permission: Permission,
  input: NotificationInput,
): Promise<number> {
  const userIds = await usersWithPermissionAtBranch(db, target, permission);
  return notifyUsers(
    db,
    userIds,
    { workspaceId: target.workspaceId, branchId: target.branchId },
    input,
  );
}

/** Count unread notifications (used by the bell badge). */
export async function unreadCount(db: Executor, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}
