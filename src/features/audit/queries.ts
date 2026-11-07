"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type { AuditLogDto, Paginated } from "@ros/contracts/platform";
import { api } from "@/lib/api-client";

export interface AuditFilters {
  action?: string;
  actor?: string;
  actorType?: string;
  from?: string;
  to?: string;
  workspaceId?: string;
  page: number;
}

export const auditKeys = {
  workspace: (workspaceId: string, f: AuditFilters) =>
    ["workspace", workspaceId, "audit", f] as const,
  admin: (f: AuditFilters) => ["admin", "audit", f] as const,
};

const PAGE_SIZE = 25;

export function useWorkspaceAudit(workspaceId: string, filters: AuditFilters) {
  return useQuery({
    queryKey: auditKeys.workspace(workspaceId, filters),
    queryFn: ({ signal }) =>
      api.get<Paginated<AuditLogDto>>(
        `/workspaces/${workspaceId}/audit`,
        { ...filters, workspaceId: undefined, pageSize: PAGE_SIZE },
        signal,
      ),
    placeholderData: keepPreviousData,
  });
}

export function useAdminAudit(filters: AuditFilters) {
  return useQuery({
    queryKey: auditKeys.admin(filters),
    queryFn: ({ signal }) =>
      api.get<Paginated<AuditLogDto>>("/admin/audit", { ...filters, pageSize: PAGE_SIZE }, signal),
    placeholderData: keepPreviousData,
  });
}
