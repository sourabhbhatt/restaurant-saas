import type {
  AdminPlanDto,
  AnnouncementDto,
  AnnouncementInput,
  AuditLogDto,
  EntitlementOverrideDto,
  Paginated,
  PlanInput,
  PublicAnnouncementDto,
  SubscriptionEventDto,
  SupportCategory,
  SupportNoteDto,
  SupportPriority,
  SupportRequestDto,
  SupportStatus,
} from "@/contracts/platform";
import type { NotificationInput } from "@/contracts/notifications";
import type {
  BillingCycle,
  FeatureKey,
  PlanLimits,
  SubscriptionStatus,
  WorkspaceStatus,
} from "@/domain/subscriptions/entitlements";
import type { AuditRepository } from "@/server/ports/core-repositories";

/** Current subscription with its plan, dates as Date. */
export interface SubscriptionRow {
  id: string;
  /** The billing owner; null only for a row not yet backfilled. */
  organizationId: string | null;
  /** Legacy column, dual-written: the organization's first workspace. */
  workspaceId: string;
  planId: string;
  planKey: string;
  planName: string;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  trialStartsAt: Date | null;
  trialEndsAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelledAt: Date | null;
  remindersSent: number[];
  notes: string | null;
  createdAt: Date;
}

export interface PlanRecordRow {
  id: string;
  key: string;
  name: string;
  limits: PlanLimits;
  maxWorkspaces: number | null;
  features: FeatureKey[];
}

export interface AdminWorkspaceBaseRow {
  id: string;
  name: string;
  slug: string;
  status: WorkspaceStatus;
  createdAt: Date;
  ownerEmail: string | null;
  subscription: SubscriptionRow | null;
  plan: PlanRecordRow | null;
  overrides: { key: string; value: unknown }[];
  counts: { restaurants: number; branches: number; users: number };
}

export interface WorkspaceRecord {
  id: string;
  organizationId: string | null;
  name: string;
  slug: string;
  status: WorkspaceStatus;
  statusReason: string | null;
  country: string;
  defaultCurrency: string;
  businessEmail: string | null;
  createdAt: Date;
}

export interface OrganizationRecord {
  id: string;
  name: string;
  status: "ACTIVE" | "SUSPENDED";
  maxWorkspacesOverride: number | null;
  workspaceCount: number;
}

export interface WorkspaceMemberRow {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  roleKey: string;
  roleName: string;
  status: "ACTIVE" | "DISABLED";
  joinedAt: Date;
}

export interface RestaurantTreeRow {
  id: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
  branches: { id: string; name: string; code: string; city: string | null; status: string }[];
}

export interface SweepCandidate {
  subscription: SubscriptionRow;
  workspaceName: string;
}

export interface SupportFilter {
  workspaceId?: string;
  createdBy?: string;
  status?: SupportStatus;
  category?: SupportCategory;
  priority?: SupportPriority;
  q?: string;
  assignedTo?: string;
  unassigned?: boolean;
}

export interface AuditFilter {
  workspaceId?: string;
  action?: string;
  actor?: string;
  actorType?: string;
  from?: Date;
  to?: Date;
}

export interface Recipient {
  userId: string;
  email: string;
  name: string;
}

export interface UpgradeRow {
  id: string;
  workspaceId: string;
  workspaceName: string;
  requestedById: string | null;
  requestedByName: string | null;
  requestedByEmail: string | null;
  currentPlanId: string | null;
  currentPlanKey: string | null;
  currentPlanName: string | null;
  requestedPlanId: string;
  requestedPlanKey: string;
  requestedPlanName: string;
  requestedPlanMonthlyPrice: number | null;
  requestedPlanCurrency: string;
  billingCycle: BillingCycle;
  message: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  decidedByName: string | null;
  decidedAt: Date | null;
  decisionReason: string | null;
  createdAt: Date;
}

export interface UpgradeEventRow {
  id: string;
  type: "CREATED" | "NOTE" | "APPROVED" | "REJECTED" | "CANCELLED";
  actorName: string | null;
  body: string | null;
  createdAt: Date;
}

export interface UpgradeRepository {
  insertUpgradeRequest(input: {
    workspaceId: string;
    requestedBy: string;
    currentPlanId: string | null;
    requestedPlanId: string;
    billingCycle: BillingCycle;
    message: string | null;
  }): Promise<string>;
  findUpgradeRequest(requestId: string): Promise<UpgradeRow | null>;
  listUpgradeRequests(filter: {
    workspaceId?: string;
    status?: UpgradeRow["status"];
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<{ rows: UpgradeRow[]; total: number }>;
  countPendingUpgradeRequests(): Promise<number>;
  /**
   * Atomically moves a PENDING request to `status`. Returns false when it is no
   * longer PENDING (someone else decided it first), so a request is decided once.
   */
  decideUpgradeRequest(input: {
    requestId: string;
    status: "APPROVED" | "REJECTED" | "CANCELLED";
    decidedBy: string;
    decidedAt: Date;
    reason: string | null;
    appliedSubscriptionId: string | null;
  }): Promise<boolean>;
  insertUpgradeEvent(input: {
    requestId: string;
    type: UpgradeEventRow["type"];
    actorUserId: string | null;
    body: string | null;
  }): Promise<void>;
  listUpgradeEvents(requestId: string): Promise<UpgradeEventRow[]>;
}

export interface PlatformRepository extends UpgradeRepository {
  // plans
  listPlans(filter?: { publicActiveOnly?: boolean }): Promise<AdminPlanDto[]>;
  findPlanById(planId: string): Promise<AdminPlanDto | null>;
  findPlanByKey(key: string): Promise<AdminPlanDto | null>;
  insertPlan(input: PlanInput): Promise<AdminPlanDto>;
  updatePlan(planId: string, input: PlanInput): Promise<AdminPlanDto | null>;

  // settings
  loadSettingRows(): Promise<{ key: string; value: unknown }[]>;
  upsertSettings(values: Record<string, unknown>, actorUserId: string): Promise<void>;

  // announcements
  listAnnouncements(): Promise<AnnouncementDto[]>;
  listActiveAnnouncements(now: Date): Promise<PublicAnnouncementDto[]>;
  insertAnnouncement(input: AnnouncementInput, actorUserId: string): Promise<AnnouncementDto>;
  updateAnnouncement(id: string, input: AnnouncementInput): Promise<AnnouncementDto | null>;
  deleteAnnouncement(id: string): Promise<boolean>;

  // subscriptions: every method resolves the workspace to its organization, the billing owner
  findCurrentSubscription(workspaceId: string): Promise<SubscriptionRow | null>;
  /** Marks the current subscription non-current (call before inserting a new one). */
  retireCurrentSubscription(workspaceId: string): Promise<void>;
  /** Inserts the organization's subscription; `workspace_id` is dual-written as its first workspace. */
  insertSubscription(input: {
    workspaceId: string;
    planId: string;
    status: SubscriptionStatus;
    billingCycle: BillingCycle;
    trialStartsAt?: Date | null;
    trialEndsAt?: Date | null;
    currentPeriodStart?: Date | null;
    currentPeriodEnd?: Date | null;
    notes?: string | null;
    activatedBy?: string | null;
  }): Promise<string>;
  updateSubscription(
    subscriptionId: string,
    workspaceId: string,
    patch: Partial<{
      status: SubscriptionStatus;
      trialEndsAt: Date | null;
      currentPeriodEnd: Date | null;
      cancelledAt: Date | null;
      remindersSent: number[];
    }>,
  ): Promise<void>;
  /** Conditional update: only succeeds if reminders_sent still equals `expected`. */
  compareAndSetReminders(
    subscriptionId: string,
    expected: readonly number[],
    next: readonly number[],
  ): Promise<boolean>;
  insertSubscriptionEvent(input: {
    workspaceId: string;
    subscriptionId: string | null;
    type: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    planKey?: string | null;
    actorUserId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  listSubscriptionEvents(workspaceId: string, limit: number): Promise<SubscriptionEventDto[]>;
  listSweepCandidates(): Promise<SweepCandidate[]>;

  // workspaces (Super Admin)
  listWorkspacesForAdmin(filter: {
    q?: string;
    status?: WorkspaceStatus;
  }): Promise<AdminWorkspaceBaseRow[]>;
  findWorkspace(workspaceId: string): Promise<WorkspaceRecord | null>;
  setWorkspaceStatus(
    workspaceId: string,
    status: WorkspaceStatus,
    reason: string,
  ): Promise<WorkspaceRecord | null>;
  findOrganization(organizationId: string): Promise<OrganizationRecord | null>;
  findOrganizationOfWorkspace(workspaceId: string): Promise<OrganizationRecord | null>;
  setOrganizationMaxWorkspacesOverride(
    organizationId: string,
    value: number | null,
  ): Promise<OrganizationRecord | null>;
  listMembers(workspaceId: string): Promise<WorkspaceMemberRow[]>;
  listRestaurantTree(workspaceId: string): Promise<RestaurantTreeRow[]>;
  listOverrides(workspaceId: string): Promise<EntitlementOverrideDto[]>;
  upsertOverride(input: {
    workspaceId: string;
    key: string;
    value: number | boolean | null;
    reason: string;
    createdBy: string;
  }): Promise<void>;
  deleteOverride(workspaceId: string, key: string): Promise<boolean>;

  // notifications
  listWorkspaceOwners(workspaceId: string): Promise<Recipient[]>;
  notify(userIds: string[], workspaceId: string, input: NotificationInput): Promise<number>;
  /** User ids (of those given) who turned off email for this notification type. */
  emailOptOuts(userIds: string[], type: string): Promise<Set<string>>;

  // support
  insertSupportRequest(input: {
    workspaceId: string;
    createdBy: string;
    contactEmail: string;
    subject: string;
    message: string;
    category: SupportCategory;
    priority: SupportPriority;
  }): Promise<SupportRequestDto>;
  listSupportRequests(
    filter: SupportFilter,
    page: number,
    pageSize: number,
  ): Promise<Paginated<SupportRequestDto>>;
  findSupportRequest(id: string): Promise<SupportRequestDto | null>;
  updateSupportRequest(
    id: string,
    patch: Partial<{
      status: SupportStatus;
      priority: SupportPriority;
      assignedTo: string | null;
      resolvedAt: Date | null;
    }>,
  ): Promise<SupportRequestDto | null>;
  listSupportNotes(requestId: string): Promise<SupportNoteDto[]>;
  insertSupportNote(input: {
    requestId: string;
    authorId: string;
    body: string;
  }): Promise<SupportNoteDto>;
  findOpenUpgradeRequest(workspaceId: string): Promise<{
    id: string;
    subject: string;
    requestedPlanKey: string;
    requestedPlanName: string;
    createdAt: string;
  } | null>;

  // audit
  listAudit(filter: AuditFilter, page: number, pageSize: number): Promise<Paginated<AuditLogDto>>;
}

export interface PlatformRepos {
  platform: PlatformRepository;
  audit: AuditRepository;
}

/** Outgoing email port (wired to the outbox-backed sender; never throws). */
export interface PlatformMailer {
  send(to: string, template: string, subject: string, text: string): Promise<void>;
}
