"use client";

import { Building2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  StatusBadge,
  type DataTableColumn,
} from "@/components/shared/feedback";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SUBSCRIPTION_PHASES, type AdminWorkspaceRowDto } from "@/contracts/platform";
import { WORKSPACE_STATUSES, type SubscriptionPhase } from "@/domain/subscriptions/entitlements";
import { formatDate, PHASE_LABEL, PHASE_TONE } from "@/features/subscriptions/subscription-ui";
import { errorMessage } from "@/lib/api-client";

import { useAdminWorkspaces, type WorkspaceListFilters } from "./queries";
import { useDebouncedValue } from "./use-debounced-value";
import { WorkspaceStatusBadge } from "./workspace-status-badge";

const columns: DataTableColumn<AdminWorkspaceRowDto>[] = [
  {
    id: "name",
    header: "Workspace",
    cell: (w) => (
      <div className="flex min-w-0 flex-col">
        <span className="max-w-56 truncate font-medium">{w.name}</span>
        <span className="max-w-56 truncate text-xs text-muted-foreground">
          {w.ownerEmail ?? w.slug}
        </span>
      </div>
    ),
  },
  { id: "status", header: "Status", cell: (w) => <WorkspaceStatusBadge status={w.status} /> },
  { id: "plan", header: "Plan", cell: (w) => w.planName ?? "—" },
  {
    id: "phase",
    header: "Phase",
    cell: (w) => (
      <StatusBadge tone={PHASE_TONE[w.phase]} dot>
        {PHASE_LABEL[w.phase]}
      </StatusBadge>
    ),
  },
  {
    id: "trial",
    header: "Trial left",
    align: "right",
    cell: (w) =>
      w.trialDaysRemaining === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className="tabular-nums">{w.trialDaysRemaining} d</span>
      ),
  },
  {
    id: "counts",
    header: "Restaurants / branches / users",
    align: "right",
    cell: (w) => (
      <span className="tabular-nums">
        {w.counts.restaurants} / {w.counts.branches} / {w.counts.users}
      </span>
    ),
  },
  {
    id: "created",
    header: "Created",
    cell: (w) => <span className="whitespace-nowrap">{formatDate(w.createdAt)}</span>,
  },
];

/** /admin/workspaces */
export function AdminWorkspacesPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<WorkspaceListFilters>({ page: 1 });
  const q = useDebouncedValue(search.trim());
  const list = useAdminWorkspaces({ ...filters, q: q || undefined });
  const pageCount = list.data ? Math.ceil(list.data.total / list.data.pageSize) : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Workspaces"
        description={
          list.data
            ? `${list.data.total.toLocaleString("en-IN")} workspace${list.data.total === 1 ? "" : "s"}`
            : "Every customer workspace on the platform."
        }
      />
      <FilterBar>
        <SearchInput
          aria-label="Search workspaces"
          placeholder="Name, URL or member email"
          value={search}
          onValueChange={(v) => {
            setSearch(v);
            setFilters((f) => ({ ...f, page: 1 }));
          }}
        />
        <Select
          value={filters.status ?? "all"}
          onValueChange={(v) =>
            setFilters((f) => ({
              ...f,
              page: 1,
              status: v === "all" ? undefined : (v as WorkspaceListFilters["status"]),
            }))
          }
        >
          <SelectTrigger aria-label="Workspace status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {WORKSPACE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.phase ?? "all"}
          onValueChange={(v) =>
            setFilters((f) => ({
              ...f,
              page: 1,
              phase: v === "all" ? undefined : (v as SubscriptionPhase),
            }))
          }
        >
          <SelectTrigger aria-label="Subscription phase">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All phases</SelectItem>
            {SUBSCRIPTION_PHASES.map((p) => (
              <SelectItem key={p} value={p}>
                {PHASE_LABEL[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>
      {list.isError ? (
        <ErrorState
          message={errorMessage(list.error)}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : (
        <DataTable
          aria-label="Workspaces"
          columns={columns}
          rows={list.data?.items ?? []}
          rowKey="id"
          loading={list.isPending}
          onRowClick={(w) => router.push(`/admin/workspaces/${w.id}`)}
          rowLabel={(w) => `Open workspace ${w.name}`}
          empty={
            <EmptyState
              size="compact"
              icon={<Building2 />}
              title="No workspaces match"
              description="Try a different search or clear the filters."
            />
          }
        />
      )}
      {pageCount > 1 ? (
        <Pagination
          page={filters.page}
          pageCount={pageCount}
          onPageChange={(page) => setFilters((f) => ({ ...f, page }))}
        />
      ) : null}
    </div>
  );
}
