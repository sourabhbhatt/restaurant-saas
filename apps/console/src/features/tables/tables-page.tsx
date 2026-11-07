"use client";

import {
  LayoutGrid,
  ListPlus,
  MoreVertical,
  Pencil,
  Plus,
  Printer,
  QrCode,
  Trash2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  PageSkeleton,
  StatusBadge,
  type StatusTone,
} from "@ros/ui/shared/feedback";
import { Button } from "@ros/ui/ui/button";
import { Checkbox } from "@ros/ui/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ros/ui/ui/dropdown-menu";
import { SearchInput } from "@ros/ui/ui/search-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ros/ui/ui/select";
import { Toaster } from "@ros/ui/ui/sonner";
import type { TableDto } from "@ros/contracts/tables";
import { TABLE_STATUSES, type TableStatus } from "@ros/domain/tables/table-status";
import { errorMessage } from "@ros/api-client";
import { cn } from "@ros/ui/utils";
import { permissionChecker, useBranchContext } from "@ros/web-core/features/session/queries";

import { QrDialog } from "./qr-dialog";
import { useDeleteTable, useTables } from "./queries";
import { BulkTablesDialog, TableDialog } from "./table-dialogs";

const TABLE_STATUS_META: Record<TableStatus, { label: string; tone: StatusTone }> = {
  AVAILABLE: { label: "Available", tone: "success" },
  OCCUPIED: { label: "Occupied", tone: "info" },
  BILL_REQUESTED: { label: "Bill requested", tone: "warning" },
  BILL_GENERATED: { label: "Bill generated", tone: "warning" },
  PAYMENT_PENDING: { label: "Payment pending", tone: "danger" },
  CLOSED: { label: "Out of service", tone: "neutral" },
};

const NO_SECTION = "__none__";

/** /app/b/[branchId]/tables — table grid with live status, QR management and printing. */
export function TablesPage() {
  const { branchId } = useParams<{ branchId: string }>();
  const ctx = useBranchContext(branchId);
  const can = permissionChecker(ctx.data?.permissions);
  const canManage = can("tables.manage");
  const tables = useTables(branchId, Boolean(ctx.data));

  const [section, setSection] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ table: TableDto | null } | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [qrTable, setQrTable] = useState<TableDto | null>(null);
  const [deleting, setDeleting] = useState<TableDto | null>(null);
  const del = useDeleteTable();

  const sections = useMemo(
    () =>
      [
        ...new Set((tables.data ?? []).map((t) => t.section).filter((s): s is string => !!s)),
      ].sort(),
    [tables.data],
  );
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (tables.data ?? []).filter(
      (t) =>
        (section === "all" || (section === NO_SECTION ? !t.section : t.section === section)) &&
        (status === "all" || t.status === status) &&
        (!q || t.name.toLowerCase().includes(q)),
    );
  }, [tables.data, section, status, search]);

  if (ctx.isPending || tables.isPending) return <PageSkeleton variant="cards" />;
  if (ctx.isError || tables.isError) {
    return (
      <ErrorState
        title="Couldn't load tables"
        message={errorMessage(ctx.error ?? tables.error)}
        onRetry={() => void (ctx.isError ? ctx.refetch() : tables.refetch())}
      />
    );
  }

  const all = tables.data;
  const counts = TABLE_STATUSES.map((s) => [s, all.filter((t) => t.status === s).length] as const);
  const printIds = selected.size > 0 ? [...selected] : filtered.map((t) => t.id);
  const printHref = `/print/tables?branchId=${branchId}${
    printIds.length && printIds.length !== all.length ? `&tableIds=${printIds.join(",")}` : ""
  }`;
  const qrLive = qrTable ? (all.find((t) => t.id === qrTable.id) ?? qrTable) : null;

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-6">
      <Toaster />
      <PageHeader
        title="Tables & QR"
        description={`${all.length} tables · ${all.filter((t) => t.status !== "AVAILABLE" && t.status !== "CLOSED").length} in use right now`}
        actions={
          canManage ? (
            <>
              {all.length > 0 && (
                <Button variant="outline" asChild>
                  <Link href={printHref} target="_blank" rel="noopener">
                    <Printer aria-hidden />
                    {selected.size > 0 ? `Print ${selected.size} QR` : "Print QR codes"}
                  </Link>
                </Button>
              )}
              <Button variant="outline" onClick={() => setBulkOpen(true)}>
                <ListPlus aria-hidden /> Add several
              </Button>
              <Button onClick={() => setEditing({ table: null })}>
                <Plus aria-hidden /> Add table
              </Button>
            </>
          ) : undefined
        }
      />

      {all.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid />}
          title="No tables yet"
          description={
            canManage
              ? "Add your tables, then print a QR code for each so guests can order."
              : "A manager hasn't set up tables for this branch yet."
          }
          action={
            canManage ? (
              <>
                <Button onClick={() => setBulkOpen(true)}>
                  <ListPlus aria-hidden /> Add T1–T10
                </Button>
                <Button variant="outline" onClick={() => setEditing({ table: null })}>
                  <Plus aria-hidden /> Add one table
                </Button>
              </>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-2" aria-label="Status summary">
            {counts
              .filter(([, n]) => n > 0)
              .map(([s, n]) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(status === s ? "all" : s)}
                  aria-pressed={status === s}
                  className="rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <StatusBadge
                    tone={TABLE_STATUS_META[s].tone}
                    dot
                    className={cn(status === s && "ring-2 ring-ring/40")}
                  >
                    {TABLE_STATUS_META[s].label} · {n}
                  </StatusBadge>
                </button>
              ))}
          </div>
          <FilterBar
            actions={
              canManage && selected.size > 0 ? (
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                  Clear selection ({selected.size})
                </Button>
              ) : undefined
            }
          >
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder="Search tables"
              aria-label="Search tables"
            />
            <Select value={section} onValueChange={setSection}>
              <SelectTrigger aria-label="Section filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sections</SelectItem>
                {sections.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
                <SelectItem value={NO_SECTION}>No section</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger aria-label="Status filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                {TABLE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {TABLE_STATUS_META[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterBar>

          {filtered.length === 0 ? (
            <EmptyState
              size="compact"
              icon={<LayoutGrid />}
              title="No tables match"
              description="Try another section, status or search."
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setSection("all");
                    setStatus("all");
                    setSearch("");
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
              {filtered.map((t) => {
                const meta = TABLE_STATUS_META[t.status];
                return (
                  <li
                    key={t.id}
                    className={cn(
                      "flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-xs",
                      selected.has(t.id) && "border-primary ring-2 ring-primary/20",
                      !t.isActive && "bg-muted/40",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        {canManage && (
                          <Checkbox
                            checked={selected.has(t.id)}
                            onCheckedChange={(on) => toggle(t.id, Boolean(on))}
                            aria-label={`Select ${t.name} for printing`}
                          />
                        )}
                        <span className="truncate text-lg font-semibold">{t.name}</span>
                      </div>
                      {canManage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`${t.name} actions`}>
                              <MoreVertical aria-hidden />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setQrTable(t)}>
                              <QrCode aria-hidden /> QR code
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setEditing({ table: t })}>
                              <Pencil aria-hidden /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(t)}>
                              <Trash2 aria-hidden /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                    <StatusBadge tone={meta.tone} dot pulse={t.status === "BILL_REQUESTED"}>
                      {meta.label}
                    </StatusBadge>
                    <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="size-3.5" aria-hidden /> {t.capacity}
                      </span>
                      <span className="truncate">{t.section ?? "—"}</span>
                    </div>
                    {canManage && (
                      <Button
                        variant={t.qr.active ? "outline" : "secondary"}
                        size="sm"
                        onClick={() => setQrTable(t)}
                      >
                        <QrCode aria-hidden /> {t.qr.active ? "View QR" : "Create QR"}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {canManage && (
        <>
          <TableDialog
            open={editing !== null}
            onOpenChange={(o) => !o && setEditing(null)}
            branchId={branchId}
            table={editing?.table ?? null}
            sections={sections}
          />
          <BulkTablesDialog open={bulkOpen} onOpenChange={setBulkOpen} branchId={branchId} />
          <QrDialog table={qrLive} onOpenChange={(o) => !o && setQrTable(null)} />
          <ConfirmDialog
            open={deleting !== null}
            onOpenChange={(o) => !o && setDeleting(null)}
            title={`Delete ${deleting?.name ?? "table"}?`}
            description="Its QR code stops working. Past orders and bills are kept."
            confirmLabel="Delete table"
            destructive
            getErrorMessage={errorMessage}
            onConfirm={async () => {
              if (!deleting) return;
              await del.mutateAsync(deleting.id);
              toggle(deleting.id, false);
              toast.success(`${deleting.name} deleted`);
            }}
          />
        </>
      )}
    </div>
  );
}
