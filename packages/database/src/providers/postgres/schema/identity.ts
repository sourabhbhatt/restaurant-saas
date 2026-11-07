import { sql } from "drizzle-orm";
import { check, index, inet, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { id, timestamps, tstz } from "./_helpers";

export const users = pgTable(
  "users",
  {
    id: id(),
    /** Always stored lower-cased and trimmed. */
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    emailVerifiedAt: tstz("email_verified_at"),
    /** Platform-level role. Only SUPER_ADMIN exists; never derived from client input. */
    platformRole: text("platform_role").$type<"SUPER_ADMIN">(),
    lastLoginAt: tstz("last_login_at"),
    disabledAt: tstz("disabled_at"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_email_uq").on(t.email),
    check("users_email_lower_ck", sql`${t.email} = lower(${t.email})`),
    check(
      "users_platform_role_ck",
      sql`${t.platformRole} is null or ${t.platformRole} = 'SUPER_ADMIN'`,
    ),
  ],
);

export const userProfiles = pgTable("user_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  phone: text("phone"),
  avatarKey: text("avatar_key"),
  locale: text("locale").notNull().default("en-IN"),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  ...timestamps,
});

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the opaque cookie token. */
    tokenHash: text("token_hash").notNull(),
    expiresAt: tstz("expires_at").notNull(),
    lastSeenAt: tstz("last_seen_at").notNull().defaultNow(),
    revokedAt: tstz("revoked_at"),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    activeWorkspaceId: uuid("active_workspace_id"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_uq").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
  ],
);

export const AUTH_TOKEN_PURPOSES = ["EMAIL_VERIFICATION", "PASSWORD_RESET"] as const;

/** Single-use tokens for email verification and password reset. */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").$type<(typeof AUTH_TOKEN_PURPOSES)[number]>().notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: tstz("expires_at").notNull(),
    usedAt: tstz("used_at"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("auth_tokens_hash_uq").on(t.tokenHash),
    index("auth_tokens_user_purpose_idx").on(t.userId, t.purpose),
    check("auth_tokens_purpose_ck", sql`${t.purpose} in ('EMAIL_VERIFICATION', 'PASSWORD_RESET')`),
  ],
);
