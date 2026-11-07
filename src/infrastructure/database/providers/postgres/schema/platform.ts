import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  BillingCycle,
  FeatureKey,
  PlanLimits,
  SubscriptionStatus,
} from "@/domain/subscriptions/entitlements";

import { id, money, timestamps, tstz } from "./_helpers";
import { users } from "./identity";
import { organizations, workspaces } from "./tenancy";

export const subscriptionPlans = pgTable(
  "subscription_plans",
  {
    id: id(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    currency: text("currency").notNull().default("INR"),
    /** null = custom pricing ("Contact us"). */
    monthlyPrice: money("monthly_price"),
    annualPrice: money("annual_price"),
    isTrialEligible: boolean("is_trial_eligible").notNull().default(true),
    /** Shown on the public pricing page and upgrade modal. */
    isPublic: boolean("is_public").notNull().default(true),
    status: text("status").$type<"ACTIVE" | "ARCHIVED">().notNull().default("ACTIVE"),
    limits: jsonb("limits").$type<PlanLimits>().notNull(),
    features: jsonb("features").$type<FeatureKey[]>().notNull().default([]),
    /**
     * Workspaces per organization on ANNUAL billing (trial, grace and monthly
     * allow 1); null = unlimited within fair use (spec section 7.2).
     */
    maxWorkspaces: integer("max_workspaces").default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex("subscription_plans_key_uq").on(t.key)],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    /**
     * Legacy billing owner, kept and dual-written until the contract step
     * (spec section 9.2): the organization's first workspace.
     */
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** The billing owner. Nullable only until the contract step; backfilled for every row. */
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => subscriptionPlans.id),
    status: text("status").$type<SubscriptionStatus>().notNull(),
    billingCycle: text("billing_cycle").$type<BillingCycle>().notNull().default("MONTHLY"),
    trialStartsAt: tstz("trial_starts_at"),
    trialEndsAt: tstz("trial_ends_at"),
    currentPeriodStart: tstz("current_period_start"),
    currentPeriodEnd: tstz("current_period_end"),
    cancelledAt: tstz("cancelled_at"),
    /** Trial reminder days already sent (e.g. [7, 15]). */
    remindersSent: jsonb("reminders_sent").$type<number[]>().notNull().default([]),
    notes: text("notes"),
    isCurrent: boolean("is_current").notNull().default(true),
    activatedBy: uuid("activated_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("subscriptions_current_uq")
      .on(t.workspaceId)
      .where(sql`${t.isCurrent}`),
    uniqueIndex("subscriptions_current_org_uq")
      .on(t.organizationId)
      .where(sql`${t.isCurrent} and ${t.organizationId} is not null`),
    check(
      "subscriptions_status_ck",
      sql`${t.status} in ('TRIALING','ACTIVE','CANCELLED','EXPIRED')`,
    ),
  ],
);

export const subscriptionEvents = pgTable(
  "subscription_events",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    type: text("type").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    planKey: text("plan_key"),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [index("subscription_events_workspace_idx").on(t.workspaceId, t.createdAt)],
);

/** Per-workspace overrides set by Super Admin (limit keys or "feature:<key>"). */
export const workspaceEntitlements = pgTable(
  "workspace_entitlements",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").$type<number | boolean | null>(),
    reason: text("reason"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("workspace_entitlements_uq").on(t.workspaceId, t.key)],
);

/** Key/value platform configuration (trial days, grace days, branding, ...). */
export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: tstz("updated_at").notNull().defaultNow(),
});

export const announcements = pgTable("announcements", {
  id: id(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  level: text("level").$type<"INFO" | "WARNING" | "CRITICAL">().notNull().default("INFO"),
  startsAt: tstz("starts_at").notNull().defaultNow(),
  endsAt: tstz("ends_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
});

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id"),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    /** Safe, non-sensitive metadata (ids for deep links). */
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    readAt: tstz("read_at"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.readAt, t.createdAt)],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    inApp: boolean("in_app").notNull().default(true),
    email: boolean("email").notNull().default(true),
    push: boolean("push").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("notification_preferences_uq").on(t.userId, t.type)],
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    keys: jsonb("keys").$type<{ p256dh: string; auth: string }>().notNull(),
    userAgent: text("user_agent"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_uq").on(t.endpoint)],
);

/** Outgoing email log / outbox (also the dev mailbox when no provider is configured). */
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: id(),
    toAddress: text("to_address").notNull(),
    subject: text("subject").notNull(),
    template: text("template").notNull(),
    textBody: text("text_body").notNull(),
    htmlBody: text("html_body"),
    status: text("status").$type<"PENDING" | "SENT" | "FAILED">().notNull().default("PENDING"),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: tstz("created_at").notNull().defaultNow(),
    sentAt: tstz("sent_at"),
  },
  (t) => [index("email_outbox_status_idx").on(t.status, t.createdAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id"),
    actorType: text("actor_type").$type<"USER" | "GUEST" | "SYSTEM" | "PLATFORM_ADMIN">().notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    /** Safe metadata only: never passwords, tokens or payment secrets. */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    requestId: text("request_id"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_workspace_idx").on(t.workspaceId, t.createdAt),
    index("audit_logs_action_idx").on(t.action, t.createdAt),
    index("audit_logs_actor_idx").on(t.actorUserId, t.createdAt),
  ],
);

export const supportRequests = pgTable(
  "support_requests",
  {
    id: id(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    contactEmail: text("contact_email").notNull(),
    subject: text("subject").notNull(),
    message: text("message").notNull(),
    category: text("category").notNull().default("GENERAL"),
    status: text("status")
      .$type<"OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED">()
      .notNull()
      .default("OPEN"),
    priority: text("priority")
      .$type<"LOW" | "NORMAL" | "HIGH" | "URGENT">()
      .notNull()
      .default("NORMAL"),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: tstz("resolved_at"),
    ...timestamps,
  },
  (t) => [index("support_requests_status_idx").on(t.status, t.createdAt)],
);

export const supportRequestNotes = pgTable(
  "support_request_notes",
  {
    id: id(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => supportRequests.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    isInternal: boolean("is_internal").notNull().default(true),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [index("support_request_notes_request_idx").on(t.requestId, t.createdAt)],
);

/** Generic idempotency store for replayable writes (sync queue, retries). */
export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: id(),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    statusCode: integer("status_code").notNull(),
    response: jsonb("response").$type<unknown>().notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("idempotency_records_uq").on(t.scope, t.key)],
);

/** Fixed-window rate limit counters (provider independent, works across instances). */
export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: tstz("reset_at").notNull(),
});

export const UPGRADE_REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;

/**
 * A workspace owner's request to move to another plan. Super Admin decides it;
 * approval activates the plan through the normal subscription path.
 */
export const upgradeRequests = pgTable(
  "upgrade_requests",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    /** Plan the workspace was on when it asked (null = none). */
    currentPlanId: uuid("current_plan_id").references(() => subscriptionPlans.id),
    requestedPlanId: uuid("requested_plan_id")
      .notNull()
      .references(() => subscriptionPlans.id),
    billingCycle: text("billing_cycle").$type<BillingCycle>().notNull().default("MONTHLY"),
    message: text("message"),
    status: text("status")
      .$type<(typeof UPGRADE_REQUEST_STATUSES)[number]>()
      .notNull()
      .default("PENDING"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: tstz("decided_at"),
    /** Rejection reason (or cancellation note). */
    decisionReason: text("decision_reason"),
    /** Subscription created when approved. */
    appliedSubscriptionId: uuid("applied_subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    // One open request per workspace.
    uniqueIndex("upgrade_requests_one_pending_uq")
      .on(t.workspaceId)
      .where(sql`${t.status} = 'PENDING'`),
    index("upgrade_requests_status_idx").on(t.status, t.createdAt),
    index("upgrade_requests_workspace_idx").on(t.workspaceId, t.createdAt),
    check(
      "upgrade_requests_status_ck",
      sql`${t.status} in ('PENDING','APPROVED','REJECTED','CANCELLED')`,
    ),
  ],
);

/** Request history and internal notes (notes are never shown to the workspace). */
export const upgradeRequestEvents = pgTable(
  "upgrade_request_events",
  {
    id: id(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => upgradeRequests.id, { onDelete: "cascade" }),
    type: text("type")
      .$type<"CREATED" | "NOTE" | "APPROVED" | "REJECTED" | "CANCELLED">()
      .notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [index("upgrade_request_events_request_idx").on(t.requestId, t.createdAt)],
);
