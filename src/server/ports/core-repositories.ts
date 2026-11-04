/**
 * Repository ports for cross-cutting concerns (identity, access, audit,
 * entitlements, idempotency, rate limiting). Module-specific repositories are
 * declared next to their services in src/server/modules/<module>/ports.ts.
 * Implementations live in src/infrastructure/database/providers/postgres.
 */
import type {
  PlanLimits,
  FeatureKey,
  SubscriptionRecord,
  WorkspaceStatus,
} from "@/domain/subscriptions/entitlements";

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
  platformRole: "SUPER_ADMIN" | null;
  disabledAt: Date | null;
  createdAt: Date;
}

export type AuthTokenPurpose = "EMAIL_VERIFICATION" | "PASSWORD_RESET";

export interface IdentityRepository {
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  createUser(input: { email: string; name: string; passwordHash: string }): Promise<UserRecord>;
  updateUser(
    id: string,
    patch: Partial<{
      name: string;
      passwordHash: string;
      emailVerifiedAt: Date;
      lastLoginAt: Date;
    }>,
  ): Promise<void>;
  createAuthToken(input: {
    userId: string;
    purpose: AuthTokenPurpose;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  /** Atomically marks an unused, unexpired token as used. Returns its user, or null. */
  consumeAuthToken(
    tokenHash: string,
    purpose: AuthTokenPurpose,
    now: Date,
  ): Promise<{ userId: string } | null>;
  invalidateAuthTokens(userId: string, purpose: AuthTokenPurpose, now: Date): Promise<void>;
  countRecentAuthTokens(userId: string, purpose: AuthTokenPurpose, since: Date): Promise<number>;
}

export interface BranchRef {
  id: string;
  workspaceId: string;
  restaurantId: string;
  name: string;
  restaurantName: string;
  currency: string;
  timezone: string;
  status: "ACTIVE" | "ARCHIVED";
}

export interface RestaurantRef {
  id: string;
  workspaceId: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
}

export interface MembershipGrants {
  membershipId: string;
  workspaceId: string;
  workspaceName: string;
  workspaceStatus: WorkspaceStatus;
  status: "ACTIVE" | "DISABLED";
  roleKey: string;
  roleName: string;
  workspacePermissions: string[];
  assignments: {
    restaurantId: string;
    branchId: string | null;
    roleKey: string;
    roleName: string;
    permissions: string[];
  }[];
}

export interface WorkspaceSummaryForUser {
  workspaceId: string;
  name: string;
  slug: string;
  status: WorkspaceStatus;
  roleKey: string;
  roleName: string;
}

export interface AccessRepository {
  findBranchRef(branchId: string): Promise<BranchRef | null>;
  findRestaurantRef(restaurantId: string): Promise<RestaurantRef | null>;
  findWorkspaceName(workspaceId: string): Promise<string | null>;
  /** Active membership with permissions; null if the user is not a member. */
  loadMembershipGrants(userId: string, workspaceId: string): Promise<MembershipGrants | null>;
  listUserWorkspaces(userId: string): Promise<WorkspaceSummaryForUser[]>;
  /** All non-deleted restaurants and branches of a workspace (caller filters by scope). */
  listStructure(workspaceId: string): Promise<RestaurantStructure[]>;
}

export interface RestaurantStructure {
  id: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
  logoKey: string | null;
  branches: {
    id: string;
    name: string;
    code: string;
    city: string | null;
    status: "ACTIVE" | "ARCHIVED";
  }[];
}

export interface AuditEntry {
  workspaceId: string | null;
  branchId?: string | null;
  actorType: "USER" | "GUEST" | "SYSTEM" | "PLATFORM_ADMIN";
  actorUserId: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  requestId?: string | null;
}

export interface AuditRepository {
  insert(entry: AuditEntry): Promise<void>;
}

export interface PlanRow {
  id: string;
  key: string;
  name: string;
  limits: PlanLimits;
  features: FeatureKey[];
}

export interface SubscriptionContext {
  workspaceStatus: WorkspaceStatus;
  subscription:
    (SubscriptionRecord & { id: string; planId: string; trialStartsAt: Date | null }) | null;
  plan: PlanRow | null;
  overrides: { key: string; value: unknown }[];
}

export interface WorkspaceUsage {
  restaurants: number;
  branches: number;
  staff: number;
  tables: number;
  menuItems: number;
  storageBytes: number;
}

export interface EntitlementRepository {
  loadSubscriptionContext(workspaceId: string): Promise<SubscriptionContext | null>;
  loadPlatformSettingRows(): Promise<{ key: string; value: unknown }[]>;
  countUsage(workspaceId: string): Promise<WorkspaceUsage>;
}

export interface IdempotencyRepository {
  find(
    scope: string,
    key: string,
  ): Promise<{ requestHash: string; statusCode: number; response: unknown } | null>;
  /** Returns false if a record already exists (concurrent replay). */
  save(
    scope: string,
    key: string,
    requestHash: string,
    statusCode: number,
    response: unknown,
  ): Promise<boolean>;
}

export interface RateLimitRepository {
  /** Increment the bucket and return the count within the current window. */
  hit(key: string, windowMs: number, now: Date): Promise<{ count: number; resetAt: Date }>;
}

export interface EmailOutboxRepository {
  enqueue(input: {
    to: string;
    subject: string;
    template: string;
    text: string;
    html: string | null;
    provider: string;
    delivered: boolean;
  }): Promise<string>;
  markSent(id: string, providerMessageId: string | null): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}
