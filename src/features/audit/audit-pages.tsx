"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useState } from "react";

import { PageHeader } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { useDebouncedValue } from "@/features/superadmin/use-debounced-value";

import { AuditLogView } from "./audit-log-view";
import { useAdminAudit, useWorkspaceAudit, type AuditFilters } from "./queries";

/** /app/w/[workspaceId]/audit */
export function WorkspaceAuditPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [filters, setFilters] = useState<AuditFilters>({ page: 1 });
  const query = useWorkspaceAudit(workspaceId, useDebouncedValue(filters));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit log"
        description="Who changed what in this workspace: settings, menus, staff, bills and payments."
      />
      <AuditLogView query={query} filters={filters} onFiltersChange={setFilters} />
    </div>
  );
}

/** /admin/audit (optionally ?workspaceId=...) */
export function AdminAuditPage() {
  const search = useSearchParams();
  const [filters, setFilters] = useState<AuditFilters>(() => ({
    page: 1,
    workspaceId: search.get("workspaceId") ?? undefined,
  }));
  const query = useAdminAudit(useDebouncedValue(filters));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit log"
        description={
          filters.workspaceId
            ? "Entries for one workspace."
            : "Every recorded action across workspaces and the platform."
        }
        actions={
          filters.workspaceId ? (
            <Button
              variant="outline"
              onClick={() => setFilters((f) => ({ ...f, workspaceId: undefined, page: 1 }))}
            >
              Show all workspaces
            </Button>
          ) : null
        }
      />
      <AuditLogView query={query} filters={filters} onFiltersChange={setFilters} showWorkspace />
    </div>
  );
}
