import { and, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";

import { NOTIFICATION_TYPES, type NotificationType } from "@ros/contracts/notifications";
import type { NotificationCenterRepository } from "@/server/modules/notifications/ports";

import type { Executor } from "../client";
import { notificationPreferences, notifications, pushSubscriptions } from "../schema";

const KNOWN_TYPES = new Set<string>(NOTIFICATION_TYPES);

/** Timestamps are compared at millisecond precision so JS cursors match DB rows exactly. */
const createdAtMs = sql`date_trunc('milliseconds', ${notifications.createdAt})`;

function ownFilter(userId: string, workspaceId: string | undefined): SQL {
  const own = eq(notifications.userId, userId);
  if (!workspaceId) return own;
  return and(
    own,
    or(eq(notifications.workspaceId, workspaceId), isNull(notifications.workspaceId)),
  )!;
}

function toDto(row: typeof notifications.$inferSelect) {
  return {
    id: row.id,
    type: row.type as NotificationType,
    title: row.title,
    body: row.body,
    data: row.data ?? {},
    workspaceId: row.workspaceId,
    branchId: row.branchId,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Postgres adapter for the personal notification center (read side + preferences + push). */
export function notificationCenterRepository(db: Executor): NotificationCenterRepository {
  return {
    async list(filter, page) {
      const conditions: (SQL | undefined)[] = [ownFilter(filter.userId, filter.workspaceId)];
      if (filter.unreadOnly) conditions.push(isNull(notifications.readAt));
      if (filter.type) conditions.push(eq(notifications.type, filter.type));
      if (page.before) {
        conditions.push(
          sql`(${createdAtMs}, ${notifications.id}) < (${page.before.createdAt.toISOString()}::timestamptz, ${page.before.id}::uuid)`,
        );
      }
      const rows = await db
        .select()
        .from(notifications)
        .where(and(...conditions))
        .orderBy(desc(createdAtMs), desc(notifications.id))
        .limit(page.limit);
      return rows.map(toDto);
    },

    async unreadCount(filter) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(ownFilter(filter.userId, filter.workspaceId), isNull(notifications.readAt)));
      return row?.n ?? 0;
    },

    async markRead(filter, ids, at) {
      const rows = await db
        .update(notifications)
        .set({ readAt: at })
        .where(
          and(
            ownFilter(filter.userId, filter.workspaceId),
            isNull(notifications.readAt),
            ids ? inArray(notifications.id, [...ids]) : undefined,
          ),
        )
        .returning({ id: notifications.id });
      return rows.length;
    },

    async listPreferences(userId) {
      const rows = await db
        .select({
          type: notificationPreferences.type,
          inApp: notificationPreferences.inApp,
          email: notificationPreferences.email,
          push: notificationPreferences.push,
        })
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, userId));
      return rows
        .filter((r) => KNOWN_TYPES.has(r.type))
        .map((r) => ({ ...r, type: r.type as NotificationType }));
    },

    async upsertPreferences(userId, prefs) {
      if (prefs.length === 0) return;
      await db
        .insert(notificationPreferences)
        .values(
          prefs.map((p) => ({
            userId,
            type: p.type,
            inApp: p.inApp,
            email: p.email,
            push: p.push,
          })),
        )
        .onConflictDoUpdate({
          target: [notificationPreferences.userId, notificationPreferences.type],
          set: {
            inApp: sql`excluded.in_app`,
            email: sql`excluded.email`,
            push: sql`excluded.push`,
            updatedAt: sql`now()`,
          },
        });
    },

    async upsertPushSubscription(input) {
      await db
        .insert(pushSubscriptions)
        .values({
          userId: input.userId,
          endpoint: input.endpoint,
          keys: input.keys,
          userAgent: input.userAgent,
        })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: { userId: input.userId, keys: input.keys, userAgent: input.userAgent },
        });
    },

    async deletePushSubscription(userId, endpoint) {
      const rows = await db
        .delete(pushSubscriptions)
        .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
        .returning({ id: pushSubscriptions.id });
      return rows.length > 0;
    },
  };
}
