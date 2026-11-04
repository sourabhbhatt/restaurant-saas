import QRCode from "qrcode";

import {
  bulkTableNames,
  type QrSheetDto,
  type TableDto,
  type TableQrDto,
} from "@/contracts/tables";
import { conflict, DomainError, notFound, validationFailed } from "@/domain/shared/errors";
import { deriveTableStatus } from "@/domain/tables/table-status";
import {
  UniqueViolationError,
  type TransactionRunner,
} from "@/infrastructure/database/interfaces/transaction";

import { recordAudit } from "../../audit/audit-service";
import type { AccessService, BranchScope } from "../../authz/access-service";
import { auditActorFor, type RequestMeta, type UserActor } from "../../context";
import type { Clock } from "../../ports/observability";
import type { EntitlementService } from "../../subscriptions/entitlement-service";
import type { BranchTenant, QrTokenRecord, TableRecord, TableRepos } from "./ports";
import { decryptQrToken, newQrToken, qrUrl } from "./qr-tokens";

export interface TableServiceDeps {
  tx: TransactionRunner<TableRepos>;
  clock: Clock;
  entitlements: EntitlementService;
  access: AccessService;
  appUrl: string;
  appSecret: string;
}

export function renderQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
}

const tenantOf = (scope: BranchScope): BranchTenant => ({
  workspaceId: scope.workspaceId,
  restaurantId: scope.restaurantId,
  branchId: scope.branchId,
});

const stale = () =>
  new DomainError("STALE_VERSION", "This table was changed by someone else. Reload and try again.");

const duplicateName = (name: string) =>
  validationFailed(`A table named "${name}" already exists in this branch`, {
    name: ["A table with this name already exists in this branch"],
  });

export function toTableDto(r: TableRecord): TableDto {
  return {
    id: r.id,
    branchId: r.branchId,
    name: r.name,
    capacity: r.capacity,
    section: r.section,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
    version: r.version,
    status: deriveTableStatus({ isActive: r.isActive, session: r.session, bill: r.bill }),
    session: r.session
      ? { id: r.session.id, status: r.session.status, openedAt: r.session.openedAt.toISOString() }
      : null,
    qr: { active: r.qr.active, createdAt: r.qr.createdAt?.toISOString() ?? null },
    createdAt: r.createdAt.toISOString(),
  };
}

function moveTo(ids: string[], id: string, index: number): string[] {
  const rest = ids.filter((x) => x !== id);
  const at = Math.max(0, Math.min(index, rest.length));
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

export function createTableService(deps: TableServiceDeps) {
  const { tx, clock, entitlements, access, appUrl, appSecret } = deps;

  async function qrDto(row: QrTokenRecord, tableName: string): Promise<TableQrDto> {
    const url = qrUrl(appUrl, decryptQrToken(row.tokenCiphertext, appSecret));
    return {
      tableId: row.tableId,
      tableName,
      url,
      svg: await renderQrSvg(url),
      createdAt: row.createdAt.toISOString(),
    };
  }

  const viewOrManage = (scope: BranchScope) => {
    if (!scope.can("tables.manage")) scope.require("tables.view");
  };

  async function requireTable(r: TableRepos, t: BranchTenant, tableId: string) {
    const table = await r.tables.find(t, tableId);
    if (!table) throw notFound("Table");
    return table;
  }

  async function mapUnique<T>(work: () => Promise<T>, name: string | undefined): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof UniqueViolationError && error.constraint?.includes("name")) {
        throw duplicateName(name ?? "");
      }
      throw error;
    }
  }

  return {
    /** Resolve the branch scope of a table; other tenants' tables read as NOT_FOUND. */
    async scopeForTable(actor: UserActor, tableId: string): Promise<BranchScope> {
      const loc = await tx.read((r) => r.tables.locateTable(tableId));
      if (!loc) throw notFound("Table");
      try {
        const scope = await access.forBranch(actor, loc.branchId);
        if (scope.workspaceId !== loc.workspaceId) throw notFound("Table");
        return scope;
      } catch (error) {
        if (error instanceof DomainError && error.code === "NOT_FOUND") throw notFound("Table");
        throw error;
      }
    },

    async list(scope: BranchScope): Promise<TableDto[]> {
      viewOrManage(scope);
      const rows = await tx.read((r) => r.tables.list(tenantOf(scope)));
      return rows.map(toTableDto);
    },

    async get(scope: BranchScope, tableId: string): Promise<TableDto> {
      viewOrManage(scope);
      return toTableDto(await tx.read((r) => requireTable(r, tenantOf(scope), tableId)));
    },

    async create(
      scope: BranchScope,
      input: { name: string; capacity: number; section?: string | null; isActive?: boolean },
      meta: RequestMeta,
    ): Promise<TableDto> {
      scope.require("tables.manage");
      const t = tenantOf(scope);
      await entitlements.assertCanAdd(t.workspaceId, "maxTables");
      return mapUnique(
        () =>
          tx.run(async (r) => {
            if ((await r.tables.existingNames(t, [input.name])).length > 0) {
              throw duplicateName(input.name);
            }
            const [id] = await r.tables.insert(t, [
              {
                name: input.name,
                capacity: input.capacity,
                section: input.section ?? null,
                isActive: input.isActive ?? true,
                sortOrder: await r.tables.nextSortOrder(t),
              },
            ]);
            await recordAudit(
              r.audit,
              auditActorFor(scope.actor, meta),
              "table.created",
              {
                workspaceId: t.workspaceId,
                branchId: t.branchId,
                targetType: "table",
                targetId: id,
              },
              { name: input.name, capacity: input.capacity },
            );
            return toTableDto(await requireTable(r, t, id!));
          }),
        input.name,
      );
    },

    async bulkCreate(
      scope: BranchScope,
      input: {
        prefix: string;
        from: number;
        to: number;
        capacity: number;
        section?: string | null;
      },
      meta: RequestMeta,
    ): Promise<TableDto[]> {
      scope.require("tables.manage");
      const t = tenantOf(scope);
      const names = bulkTableNames(input);
      if (names.some((n) => n.length > 30)) {
        throw validationFailed("Table names must be 30 characters or fewer", {
          prefix: ["Use a shorter prefix"],
        });
      }
      await entitlements.assertCanAdd(t.workspaceId, "maxTables", names.length);
      return mapUnique(
        () =>
          tx.run(async (r) => {
            const taken = await r.tables.existingNames(t, names);
            if (taken.length > 0) {
              const list = taken.slice(0, 5).join(", ");
              throw validationFailed(`These tables already exist: ${list}`, {
                from: [`Already exists: ${list}${taken.length > 5 ? "…" : ""}`],
              });
            }
            const start = await r.tables.nextSortOrder(t);
            const ids = await r.tables.insert(
              t,
              names.map((name, i) => ({
                name,
                capacity: input.capacity,
                section: input.section ?? null,
                isActive: true,
                sortOrder: start + i,
              })),
            );
            await recordAudit(
              r.audit,
              auditActorFor(scope.actor, meta),
              "table.bulk_created",
              {
                workspaceId: t.workspaceId,
                branchId: t.branchId,
                targetType: "branch",
                targetId: t.branchId,
              },
              { count: ids.length, first: names[0], last: names[names.length - 1] },
            );
            return (await r.tables.list(t, ids)).map(toTableDto);
          }),
        undefined,
      );
    },

    async update(
      scope: BranchScope,
      tableId: string,
      input: {
        name?: string;
        capacity?: number;
        section?: string | null;
        isActive?: boolean;
        sortOrder?: number;
        version?: number;
      },
      meta: RequestMeta,
    ): Promise<TableDto> {
      scope.require("tables.manage");
      const t = tenantOf(scope);
      return mapUnique(
        () =>
          tx.run(async (r) => {
            const current = await requireTable(r, t, tableId);
            if (input.version !== undefined && input.version !== current.version) throw stale();
            if (
              input.name !== undefined &&
              input.name !== current.name &&
              (await r.tables.existingNames(t, [input.name])).length > 0
            ) {
              throw duplicateName(input.name);
            }
            if (input.isActive === false && current.session) {
              throw conflict(
                "Close the open session on this table before taking it out of service",
              );
            }
            if (input.sortOrder !== undefined) {
              const ids = (await r.tables.list(t)).map((x) => x.id);
              await r.tables.setOrder(t, moveTo(ids, tableId, input.sortOrder));
            }
            const ok = await r.tables.update(
              t,
              tableId,
              {
                name: input.name,
                capacity: input.capacity,
                section: input.section,
                isActive: input.isActive,
              },
              input.version,
            );
            if (!ok) throw stale();
            await recordAudit(
              r.audit,
              auditActorFor(scope.actor, meta),
              "table.updated",
              {
                workspaceId: t.workspaceId,
                branchId: t.branchId,
                targetType: "table",
                targetId: tableId,
              },
              {
                fields: Object.entries(input)
                  .filter(([k, v]) => k !== "version" && v !== undefined)
                  .map(([k]) => k),
              },
            );
            return toTableDto(await requireTable(r, t, tableId));
          }),
        input.name,
      );
    },

    /** Soft delete; revokes the table's QR so printed codes stop working. */
    async remove(scope: BranchScope, tableId: string, meta: RequestMeta): Promise<void> {
      scope.require("tables.manage");
      const t = tenantOf(scope);
      await tx.run(async (r) => {
        const current = await requireTable(r, t, tableId);
        if (current.session) throw conflict("Close the open session on this table first");
        const now = clock.now();
        await r.tables.revokeActiveQr(t, tableId, scope.actor.userId, now);
        await r.tables.softDelete(t, tableId, now);
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "table.deleted",
          {
            workspaceId: t.workspaceId,
            branchId: t.branchId,
            targetType: "table",
            targetId: tableId,
          },
          { name: current.name },
        );
      });
    },

    // ---------------------------------------------------------------- QR

    /** Generate (or regenerate) the table's QR: revoke the active token, insert a new one. */
    async generateQr(scope: BranchScope, tableId: string, meta: RequestMeta): Promise<TableQrDto> {
      scope.require("tables.manage");
      const t = tenantOf(scope);
      const fresh = await newQrToken(appSecret);
      const row = await tx.run(async (r) => {
        const table = await requireTable(r, t, tableId);
        const now = clock.now();
        const revoked = await r.tables.revokeActiveQr(t, tableId, scope.actor.userId, now);
        const inserted = await r.tables.insertQr(t, {
          tableId,
          tokenHash: fresh.tokenHash,
          tokenCiphertext: fresh.tokenCiphertext,
          createdBy: scope.actor.userId,
        });
        // Never log the token itself.
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "qr.generated",
          {
            workspaceId: t.workspaceId,
            branchId: t.branchId,
            targetType: "table",
            targetId: tableId,
          },
          { regenerated: revoked > 0, qrId: inserted.id },
        );
        return { inserted, tableName: table.name };
      });
      const url = qrUrl(appUrl, fresh.token);
      return {
        tableId,
        tableName: row.tableName,
        url,
        svg: await renderQrSvg(url),
        createdAt: row.inserted.createdAt.toISOString(),
      };
    },

    async getQr(scope: BranchScope, tableId: string): Promise<TableQrDto> {
      scope.require("tables.manage");
      const t = tenantOf(scope);
      const { table, qr } = await tx.read(async (r) => ({
        table: await requireTable(r, t, tableId),
        qr: await r.tables.findActiveQr(t, tableId),
      }));
      if (!qr) throw notFound("QR code");
      return qrDto(qr, table.name);
    },

    async revokeQr(
      scope: BranchScope,
      tableId: string,
      meta: RequestMeta,
    ): Promise<{ revoked: boolean }> {
      scope.require("tables.manage");
      const t = tenantOf(scope);
      return tx.run(async (r) => {
        await requireTable(r, t, tableId);
        const n = await r.tables.revokeActiveQr(t, tableId, scope.actor.userId, clock.now());
        if (n === 0) throw notFound("QR code");
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "qr.revoked",
          {
            workspaceId: t.workspaceId,
            branchId: t.branchId,
            targetType: "table",
            targetId: tableId,
          },
          {},
        );
        return { revoked: true };
      });
    },

    /** Printable sheet: active QR codes for the selected (or all) tables. */
    async qrSheet(scope: BranchScope, tableIds: string[] | null): Promise<QrSheetDto> {
      scope.require("tables.manage");
      const t = tenantOf(scope);
      const { tables, qrs } = await tx.read(async (r) => {
        const tables = await r.tables.list(t, tableIds ?? undefined);
        return {
          tables,
          qrs: await r.tables.listActiveQr(
            t,
            tables.map((x) => x.id),
          ),
        };
      });
      const out: TableQrDto[] = [];
      const missing: QrSheetDto["missing"] = [];
      for (const table of tables) {
        const qr = qrs.find((q) => q.tableId === table.id);
        if (qr) out.push(await qrDto(qr, table.name));
        else missing.push({ id: table.id, name: table.name });
      }
      return {
        restaurantName: scope.branch.restaurantName,
        branchName: scope.branch.name,
        tables: out,
        missing,
      };
    },
  };
}

export type TableService = ReturnType<typeof createTableService>;
