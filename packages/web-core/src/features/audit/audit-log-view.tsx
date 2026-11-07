"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  StatusBadge,
  type DataTableColumn,
  type StatusTone,
} from "@ros/ui/shared/feedback";
import { Button } from "@ros/ui/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@ros/ui/ui/dialog";
import { Input } from "@ros/ui/ui/input";
import { Label } from "@ros/ui/ui/label";
import { Pagination } from "@ros/ui/ui/pagination";
import { SearchInput } from "@ros/ui/ui/search-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ros/ui/ui/select";
import { AUDIT_ACTOR_TYPES, type AuditLogDto, type Paginated } from "@ros/contracts/platform";
import { formatDateTime } from "../subscriptions/subscription-ui";
import { errorMessage } from "@ros/api-client";

import type { AuditFilters } from "./queries";

const ACTOR_TONE: Record<AuditLogDto["actorType"], StatusTone> = {
  USER: "neutral",
  GUEST: "info",
  SYSTEM: "info",
  PLATFORM_ADMIN: "warning",
};
const ACTOR_LABEL: Record<AuditLogDto["actorType"], string> = {
  USER: "User",
  GUEST: "Guest",
  SYSTEM: "System",
  PLATFORM_ADMIN: "Super Admin",
};

function MetadataDialog({ entry, onClose }: { entry: AuditLogDto | null; onClose: () => void }) {
  return (
    <Dialog open={entry !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">{entry?.action}</DialogTitle>
          <DialogDescription>
            {entry ? formatDateTime(entry.createdAt) : null}
            {entry?.actor ? ` · ${entry.actor.name} (${entry.actor.email})` : ""}
          </DialogDescription>
        </DialogHeader>
        {entry ? (
          <dl className="grid gap-3 text-sm">
            <div className="grid grid-cols-3 gap-2">
              <dt className="text-muted-foreground">Target</dt>
              <dd className="col-span-2 font-mono text-xs break-all">
                {entry.targetType ?? "—"} {entry.targetId ?? ""}
              </dd>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <dt className="text-muted-foreground">IP</dt>
              <dd className="col-span-2 font-mono text-xs">{entry.ip ?? "—"}</dd>
            </div>
            <div className="grid gap-2">
              <dt className="text-muted-foreground">Details</dt>
              <dd>
                <pre className="max-h-72 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">
                  {JSON.stringify(entry.metadata, null, 2)}
                </pre>
              </dd>
            </div>
          </dl>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Audit log table + filters, shared by the workspace and Super Admin viewers.
 * Filters are controlled by the parent so they can live in the query key.
 */
export function AuditLogView({
  query,
  filters,
  onFiltersChange,
  showWorkspace = false,
}: {
  query: UseQueryResult<Paginated<AuditLogDto>>;
  filters: AuditFilters;
  onFiltersChange: (next: AuditFilters) => void;
  showWorkspace?: boolean;
}) {
  const [selected, setSelected] = useState<AuditLogDto | null>(null);
  const set = (patch: Partial<AuditFilters>) =>
    onFiltersChange({ ...filters, ...patch, page: patch.page ?? 1 });
  const data = query.data;
  const pageCount = data ? Math.ceil(data.total / data.pageSize) : 0;
  const rangeInvalid = Boolean(filters.from && filters.to && filters.from > filters.to);

  const columns: DataTableColumn<AuditLogDto>[] = [
    {
      id: "time",
      header: "When",
      cell: (a) => <span className="whitespace-nowrap">{formatDateTime(a.createdAt)}</span>,
    },
    {
      id: "action",
      header: "Action",
      cell: (a) => <span className="font-mono text-xs">{a.action}</span>,
    },
    {
      id: "actor",
      header: "Actor",
      cell: (a) => (
        <div className="flex flex-col gap-1">
          <StatusBadge tone={ACTOR_TONE[a.actorType]}>{ACTOR_LABEL[a.actorType]}</StatusBadge>
          {a.actor ? (
            <span className="max-w-48 truncate text-xs text-muted-foreground">{a.actor.email}</span>
          ) : null}
        </div>
      ),
    },
    ...(showWorkspace
      ? [
          {
            id: "workspace",
            header: "Workspace",
            cell: (a: AuditLogDto) =>
              a.workspaceId ? (
                <Link
                  className="hover:underline"
                  href={`/admin/workspaces/${a.workspaceId}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {a.workspaceName ?? "Workspace"}
                </Link>
              ) : (
                <span className="text-muted-foreground">Platform</span>
              ),
          },
        ]
      : []),
    {
      id: "target",
      header: "Target",
      cell: (a) => <span className="text-xs text-muted-foreground">{a.targetType ?? "—"}</span>,
    },
    {
      id: "details",
      header: <span className="sr-only">Details</span>,
      align: "right",
      cell: (a) => (
        <Button
          size="xs"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            setSelected(a);
          }}
        >
          Details
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <FilterBar>
        <SearchInput
          aria-label="Filter by action"
          placeholder="Action, e.g. order or platform."
          defaultValue={filters.action ?? ""}
          onValueChange={(v) => set({ action: v.trim() || undefined })}
        />
        <SearchInput
          aria-label="Filter by actor"
          placeholder="Actor name or email"
          defaultValue={filters.actor ?? ""}
          onValueChange={(v) => set({ actor: v.trim() || undefined })}
        />
        <Select
          value={filters.actorType ?? "all"}
          onValueChange={(v) => set({ actorType: v === "all" ? undefined : v })}
        >
          <SelectTrigger aria-label="Actor type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actors</SelectItem>
            {AUDIT_ACTOR_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {ACTOR_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Label htmlFor="audit-from" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input
            id="audit-from"
            type="date"
            className="w-auto"
            value={filters.from ?? ""}
            onChange={(e) => set({ from: e.target.value || undefined })}
          />
          <Label htmlFor="audit-to" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input
            id="audit-to"
            type="date"
            className="w-auto"
            aria-invalid={rangeInvalid || undefined}
            aria-describedby={rangeInvalid ? "audit-range-error" : undefined}
            value={filters.to ?? ""}
            onChange={(e) => set({ to: e.target.value || undefined })}
          />
        </div>
      </FilterBar>
      {rangeInvalid ? (
        <p id="audit-range-error" role="alert" className="text-sm font-medium text-destructive">
          The start date must be on or before the end date.
        </p>
      ) : query.isError ? (
        <ErrorState
          message={errorMessage(query.error)}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : (
        <DataTable
          aria-label="Audit log"
          columns={columns}
          rows={data?.items ?? []}
          rowKey="id"
          loading={query.isPending}
          onRowClick={setSelected}
          rowLabel={(a) => `Show details for ${a.action}`}
          empty={
            <EmptyState
              size="compact"
              icon={<ScrollText />}
              title="No audit entries"
              description="Nothing matches these filters yet."
            />
          }
        />
      )}
      {data && data.total > 0 ? (
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {data.total.toLocaleString("en-IN")} entr{data.total === 1 ? "y" : "ies"}
          </p>
          {pageCount > 1 ? (
            <Pagination
              className="sm:w-auto"
              page={filters.page}
              pageCount={pageCount}
              onPageChange={(page) => set({ page })}
            />
          ) : null}
        </div>
      ) : null}
      <MetadataDialog entry={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
