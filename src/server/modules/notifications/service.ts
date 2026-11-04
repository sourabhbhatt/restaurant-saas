import { NOTIFICATION_TYPES } from "@/contracts/notifications";
import type {
  MarkNotificationsReadResult,
  NotificationListDto,
  NotificationPreferenceDto,
  PushConfigDto,
} from "@/contracts/notifications-api";
import type { NotificationType } from "@/contracts/notifications";
import { DomainError, validationFailed } from "@/domain/shared/errors";
import type { TransactionRunner } from "@/infrastructure/database/interfaces/transaction";

import { recordAudit } from "../../audit/audit-service";
import type { WorkspaceScope } from "../../authz/access-service";
import { auditActorFor, type RequestMeta, type UserActor } from "../../context";
import type { Clock } from "../../ports/observability";
import type { NotificationCursor, NotificationRepos } from "./ports";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(cursor: NotificationCursor): string {
  return Buffer.from(
    JSON.stringify({ t: cursor.createdAt.toISOString(), i: cursor.id }),
    "utf8",
  ).toString("base64url");
}

export function decodeCursor(raw: string): NotificationCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      t?: unknown;
      i?: unknown;
    };
    const createdAt = typeof parsed.t === "string" ? new Date(parsed.t) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) throw new Error("bad time");
    if (typeof parsed.i !== "string" || !UUID.test(parsed.i)) throw new Error("bad id");
    return { createdAt, id: parsed.i };
  } catch {
    throw validationFailed("Invalid cursor", { cursor: ["Invalid cursor"] });
  }
}

/** Default preference when the user never changed a type: everything on. */
export function defaultPreference(type: NotificationType): NotificationPreferenceDto {
  return { type, inApp: true, email: true, push: true };
}

export interface NotificationServiceDeps {
  tx: TransactionRunner<NotificationRepos>;
  clock: Clock;
  push: { enabled: boolean; publicKey: string | null };
}

/**
 * Personal notification center. Every operation is limited to the actor's own
 * rows; an optional workspace filter must come from a verified WorkspaceScope
 * (membership checked by the access service), never a raw client id.
 */
export function createNotificationService({ tx, clock, push }: NotificationServiceDeps) {
  function workspaceFilter(actor: UserActor, scope: WorkspaceScope | null) {
    if (scope && scope.actor.userId !== actor.userId) {
      throw new DomainError("FORBIDDEN", "Scope does not belong to this user");
    }
    return { userId: actor.userId, workspaceId: scope?.workspaceId };
  }

  async function getPreferences(actor: UserActor): Promise<NotificationPreferenceDto[]> {
    const stored = await tx.read((r) => r.notifications.listPreferences(actor.userId));
    const byType = new Map(stored.map((p) => [p.type, p]));
    return NOTIFICATION_TYPES.map((type) => byType.get(type) ?? defaultPreference(type));
  }

  return {
    async list(
      actor: UserActor,
      scope: WorkspaceScope | null,
      query: {
        unread: boolean;
        limit: number;
        cursor?: string;
        type?: NotificationType;
      },
    ): Promise<NotificationListDto> {
      const base = workspaceFilter(actor, scope);
      const before = query.cursor ? decodeCursor(query.cursor) : undefined;
      return tx.read(async (r) => {
        const rows = await r.notifications.list(
          { ...base, unreadOnly: query.unread, type: query.type },
          { limit: query.limit + 1, before },
        );
        const items = rows.slice(0, query.limit);
        const last = items[items.length - 1];
        const nextCursor =
          rows.length > query.limit && last
            ? encodeCursor({ createdAt: new Date(last.createdAt), id: last.id })
            : null;
        const unreadCount = await r.notifications.unreadCount(base);
        return { items, nextCursor, unreadCount };
      });
    },

    async markRead(
      actor: UserActor,
      scope: WorkspaceScope | null,
      input: { ids?: string[]; all?: boolean },
    ): Promise<MarkNotificationsReadResult> {
      const base = workspaceFilter(actor, scope);
      const ids = input.all ? null : [...new Set(input.ids ?? [])];
      if (ids && ids.length === 0) throw validationFailed("Nothing to mark as read");
      return tx.run(async (r) => {
        const updated = await r.notifications.markRead(base, ids, clock.now());
        const unreadCount = await r.notifications.unreadCount(base);
        return { updated, unreadCount };
      });
    },

    getPreferences,

    async updatePreferences(
      actor: UserActor,
      preferences: NotificationPreferenceDto[],
      meta: RequestMeta,
    ): Promise<NotificationPreferenceDto[]> {
      // Explicit field copy (no mass assignment).
      const clean = preferences.map((p) => ({
        type: p.type,
        inApp: p.inApp,
        email: p.email,
        push: p.push,
      }));
      await tx.run(async (r) => {
        await r.notifications.upsertPreferences(actor.userId, clean);
        await recordAudit(
          r.audit,
          auditActorFor(actor, meta),
          "notification.preferences_updated",
          { workspaceId: null, targetType: "user", targetId: actor.userId },
          { types: clean.map((p) => p.type) },
        );
      });
      return getPreferences(actor);
    },

    pushConfig(): PushConfigDto {
      return { enabled: push.enabled, publicKey: push.enabled ? push.publicKey : null };
    },

    async subscribePush(
      actor: UserActor,
      input: { endpoint: string; keys: { p256dh: string; auth: string } },
      userAgent: string | null,
    ): Promise<{ subscribed: true; deliveryEnabled: boolean }> {
      if (!input.endpoint.startsWith("https://")) {
        throw validationFailed("Push endpoint must use https", {
          endpoint: ["Push endpoint must use https"],
        });
      }
      await tx.run((r) =>
        r.notifications.upsertPushSubscription({
          userId: actor.userId,
          endpoint: input.endpoint,
          keys: { p256dh: input.keys.p256dh, auth: input.keys.auth },
          userAgent: userAgent ? userAgent.slice(0, 300) : null,
        }),
      );
      return { subscribed: true, deliveryEnabled: push.enabled };
    },

    async unsubscribePush(actor: UserActor, endpoint: string): Promise<{ removed: boolean }> {
      const removed = await tx.run((r) =>
        r.notifications.deletePushSubscription(actor.userId, endpoint),
      );
      return { removed };
    },
  };
}

export type NotificationService = ReturnType<typeof createNotificationService>;
