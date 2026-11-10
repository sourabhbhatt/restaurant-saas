import type { SessionStatus } from "@ros/domain/tables/table-status";
import type { AuditRepository, LimitRepository } from "../../ports/core-repositories";

export interface BranchTenant {
  workspaceId: string;
  restaurantId: string;
  branchId: string;
}

export interface TableRecord {
  id: string;
  branchId: string;
  name: string;
  capacity: number;
  section: string | null;
  isActive: boolean;
  sortOrder: number;
  version: number;
  createdAt: Date;
  session: { id: string; status: SessionStatus; openedAt: Date } | null;
  bill: { paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID" | "REFUNDED" } | null;
  qr: { active: boolean; createdAt: Date | null };
}

export interface TablePatch {
  name?: string;
  capacity?: number;
  section?: string | null;
  isActive?: boolean;
}

export interface QrTokenRecord {
  id: string;
  tableId: string;
  tokenHash: string;
  tokenCiphertext: string;
  createdAt: Date;
}

export interface TableRepository {
  /** Tenant of a table by id, used only to resolve an access scope. */
  locateTable(tableId: string): Promise<{ workspaceId: string; branchId: string } | null>;
  list(t: BranchTenant, ids?: string[]): Promise<TableRecord[]>;
  find(t: BranchTenant, tableId: string): Promise<TableRecord | null>;
  existingNames(t: BranchTenant, names: string[]): Promise<string[]>;
  nextSortOrder(t: BranchTenant): Promise<number>;
  insert(
    t: BranchTenant,
    rows: {
      name: string;
      capacity: number;
      section: string | null;
      isActive: boolean;
      sortOrder: number;
    }[],
  ): Promise<string[]>;
  /** Optimistic update; false when the version no longer matches (or row is gone). */
  update(
    t: BranchTenant,
    tableId: string,
    patch: TablePatch & { sortOrder?: number },
    expectedVersion?: number,
  ): Promise<boolean>;
  setOrder(t: BranchTenant, orderedIds: string[]): Promise<void>;
  softDelete(t: BranchTenant, tableId: string, now: Date): Promise<boolean>;

  findActiveQr(t: BranchTenant, tableId: string): Promise<QrTokenRecord | null>;
  listActiveQr(t: BranchTenant, tableIds: string[]): Promise<QrTokenRecord[]>;
  /** Marks the table's ACTIVE token REVOKED; returns how many rows changed. */
  revokeActiveQr(t: BranchTenant, tableId: string, userId: string, now: Date): Promise<number>;
  insertQr(
    t: BranchTenant,
    input: { tableId: string; tokenHash: string; tokenCiphertext: string; createdBy: string },
  ): Promise<QrTokenRecord>;
  findQrByHash(tokenHash: string): Promise<(QrTokenRecord & { status: string }) | null>;
}

export interface TableRepos {
  tables: TableRepository;
  audit: AuditRepository;
  limits: LimitRepository;
}
