import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import type { SessionStatus } from "@ros/domain/tables/table-status";
import type {
  BranchTenant,
  QrTokenRecord,
  TableRecord,
  TableRepository,
} from "@ros/application/modules/tables/ports";

import type { Executor } from "../client";
import { bills, diningTables, tableQrTokens, tableSessions } from "../schema";

type PaymentStatus = NonNullable<TableRecord["bill"]>["paymentStatus"];

const tableWhere = (t: BranchTenant, id?: string) =>
  and(
    eq(diningTables.workspaceId, t.workspaceId),
    eq(diningTables.branchId, t.branchId),
    isNull(diningTables.deletedAt),
    id ? eq(diningTables.id, id) : undefined,
  );

const qrWhere = (t: BranchTenant) =>
  and(
    eq(tableQrTokens.workspaceId, t.workspaceId),
    eq(tableQrTokens.branchId, t.branchId),
    eq(tableQrTokens.status, "ACTIVE"),
  );

function toQr(row: typeof tableQrTokens.$inferSelect): QrTokenRecord {
  return {
    id: row.id,
    tableId: row.tableId,
    tokenHash: row.tokenHash,
    tokenCiphertext: row.tokenCiphertext,
    createdAt: row.createdAt,
  };
}

export function tableRepository(db: Executor): TableRepository {
  async function list(t: BranchTenant, ids?: string[]): Promise<TableRecord[]> {
    if (ids && ids.length === 0) return [];
    const rows = await db
      .select()
      .from(diningTables)
      .where(and(tableWhere(t), ids ? inArray(diningTables.id, ids) : undefined))
      .orderBy(asc(diningTables.sortOrder), asc(diningTables.name));
    if (rows.length === 0) return [];
    const tableIds = rows.map((r) => r.id);

    const sessions = await db
      .select({
        id: tableSessions.id,
        tableId: tableSessions.tableId,
        status: tableSessions.status,
        openedAt: tableSessions.openedAt,
      })
      .from(tableSessions)
      .where(
        and(
          eq(tableSessions.workspaceId, t.workspaceId),
          eq(tableSessions.branchId, t.branchId),
          inArray(tableSessions.tableId, tableIds),
          ne(tableSessions.status, "CLOSED"),
        ),
      );
    const liveBills =
      sessions.length === 0
        ? []
        : await db
            .select({ sessionId: bills.sessionId, paymentStatus: bills.paymentStatus })
            .from(bills)
            .where(
              and(
                eq(bills.workspaceId, t.workspaceId),
                inArray(
                  bills.sessionId,
                  sessions.map((s) => s.id),
                ),
                ne(bills.status, "VOID"),
              ),
            );
    const qrs = await db
      .select({ tableId: tableQrTokens.tableId, createdAt: tableQrTokens.createdAt })
      .from(tableQrTokens)
      .where(and(qrWhere(t), inArray(tableQrTokens.tableId, tableIds)));

    return rows.map((r) => {
      const s = sessions.find((x) => x.tableId === r.id) ?? null;
      const b = s ? (liveBills.find((x) => x.sessionId === s.id) ?? null) : null;
      const q = qrs.find((x) => x.tableId === r.id) ?? null;
      return {
        id: r.id,
        branchId: r.branchId,
        name: r.name,
        capacity: r.capacity,
        section: r.section,
        isActive: r.isActive,
        sortOrder: r.sortOrder,
        version: r.version,
        createdAt: r.createdAt,
        session: s ? { id: s.id, status: s.status as SessionStatus, openedAt: s.openedAt } : null,
        bill: b ? { paymentStatus: b.paymentStatus as PaymentStatus } : null,
        qr: { active: Boolean(q), createdAt: q?.createdAt ?? null },
      };
    });
  }

  return {
    async locateTable(tableId) {
      const [row] = await db
        .select({ workspaceId: diningTables.workspaceId, branchId: diningTables.branchId })
        .from(diningTables)
        .where(and(eq(diningTables.id, tableId), isNull(diningTables.deletedAt)))
        .limit(1);
      return row ?? null;
    },
    list,
    async find(t, tableId) {
      const [row] = await list(t, [tableId]);
      return row ?? null;
    },
    async existingNames(t, names) {
      if (names.length === 0) return [];
      const rows = await db
        .select({ name: diningTables.name })
        .from(diningTables)
        .where(and(tableWhere(t), inArray(diningTables.name, names)));
      return rows.map((r) => r.name);
    },
    async nextSortOrder(t) {
      const [row] = await db
        .select({ n: sql<number>`coalesce(max(${diningTables.sortOrder}) + 1, 0)::int` })
        .from(diningTables)
        .where(tableWhere(t));
      return row?.n ?? 0;
    },
    async insert(t, rows) {
      if (rows.length === 0) return [];
      const out = await db
        .insert(diningTables)
        .values(
          rows.map((r) => ({
            workspaceId: t.workspaceId,
            restaurantId: t.restaurantId,
            branchId: t.branchId,
            name: r.name,
            capacity: r.capacity,
            section: r.section,
            isActive: r.isActive,
            sortOrder: r.sortOrder,
          })),
        )
        .returning({ id: diningTables.id });
      return out.map((r) => r.id);
    },
    async update(t, tableId, patch, expectedVersion) {
      const set: Partial<typeof diningTables.$inferInsert> = {};
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.capacity !== undefined) set.capacity = patch.capacity;
      if (patch.section !== undefined) set.section = patch.section;
      if (patch.isActive !== undefined) set.isActive = patch.isActive;
      if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder;
      const rows = await db
        .update(diningTables)
        .set({ ...set, version: sql`${diningTables.version} + 1` })
        .where(
          and(
            tableWhere(t, tableId),
            expectedVersion !== undefined ? eq(diningTables.version, expectedVersion) : undefined,
          ),
        )
        .returning({ id: diningTables.id });
      return rows.length > 0;
    },
    async setOrder(t, orderedIds) {
      for (const [i, id] of orderedIds.entries()) {
        await db
          .update(diningTables)
          .set({ sortOrder: i })
          .where(and(tableWhere(t, id), sql`${diningTables.sortOrder} <> ${i}`));
      }
    },
    async softDelete(t, tableId, now) {
      const rows = await db
        .update(diningTables)
        .set({ deletedAt: now, isActive: false, version: sql`${diningTables.version} + 1` })
        .where(tableWhere(t, tableId))
        .returning({ id: diningTables.id });
      return rows.length > 0;
    },

    async findActiveQr(t, tableId) {
      const [row] = await db
        .select()
        .from(tableQrTokens)
        .where(and(qrWhere(t), eq(tableQrTokens.tableId, tableId)))
        .limit(1);
      return row ? toQr(row) : null;
    },
    async listActiveQr(t, tableIds) {
      if (tableIds.length === 0) return [];
      const rows = await db
        .select()
        .from(tableQrTokens)
        .where(and(qrWhere(t), inArray(tableQrTokens.tableId, tableIds)));
      return rows.map(toQr);
    },
    async revokeActiveQr(t, tableId, userId, now) {
      const rows = await db
        .update(tableQrTokens)
        .set({ status: "REVOKED", revokedAt: now, revokedBy: userId })
        .where(and(qrWhere(t), eq(tableQrTokens.tableId, tableId)))
        .returning({ id: tableQrTokens.id });
      return rows.length;
    },
    async insertQr(t, input) {
      const [row] = await db
        .insert(tableQrTokens)
        .values({
          workspaceId: t.workspaceId,
          branchId: t.branchId,
          tableId: input.tableId,
          tokenHash: input.tokenHash,
          tokenCiphertext: input.tokenCiphertext,
          createdBy: input.createdBy,
        })
        .returning();
      return toQr(row!);
    },
    async findQrByHash(tokenHash) {
      const [row] = await db
        .select()
        .from(tableQrTokens)
        .where(eq(tableQrTokens.tokenHash, tokenHash))
        .limit(1);
      return row ? { ...toQr(row), status: row.status } : null;
    },
  };
}
