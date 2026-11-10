"use client";

import { ArrowUpCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  StatusBadge,
  type DataTableColumn,
} from "@ros/ui/shared/feedback";
import { Badge } from "@ros/ui/ui/badge";
import { Button } from "@ros/ui/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ros/ui/ui/dialog";
import { FormField } from "@ros/ui/ui/form-field";
import { Input } from "@ros/ui/ui/input";
import { Pagination } from "@ros/ui/ui/pagination";
import { SearchInput } from "@ros/ui/ui/search-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ros/ui/ui/select";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@ros/ui/ui/sheet";
import { Spinner } from "@ros/ui/ui/spinner";
import { Textarea } from "@ros/ui/ui/textarea";
import type { UpgradeRequestDto } from "@ros/contracts/upgrades";
import { UPGRADE_STATUSES, type UpgradeStatus } from "@ros/domain/subscriptions/upgrade-request";
import { formatDate, formatPrice } from "../subscriptions/subscription-ui";
import { errorMessage } from "@ros/api-client";
import { useAction } from "../../use-action";

import {
  useUpgradeAction,
  useUpgradeRequest,
  useUpgradeRequests,
  type UpgradeListFilters,
} from "./queries";
import { useDebouncedValue } from "./use-debounced-value";
import { ReasonConfirmDialog } from "./workspace-actions";

const TONE = {
  PENDING: "info",
  APPROVED: "success",
  REJECTED: "danger",
  CANCELLED: "neutral",
} as const;
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

const columns: DataTableColumn<UpgradeRequestDto>[] = [
  {
    id: "workspace",
    header: "Workspace",
    cell: (r) => <span className="font-medium">{r.workspaceName}</span>,
  },
  {
    id: "requester",
    header: "Requested by",
    cell: (r) =>
      r.requestedBy ? (
        <span className="flex flex-col leading-tight">
          <span>{r.requestedBy.name}</span>
          <span className="text-xs text-muted-foreground">{r.requestedBy.email}</span>
        </span>
      ) : (
        "—"
      ),
  },
  {
    id: "plans",
    header: "Current → requested",
    cell: (r) => (
      <span>
        {r.currentPlan?.name ?? "No plan"} → <strong>{r.requestedPlan.name}</strong>{" "}
        <span className="text-xs text-muted-foreground">
          ({r.billingCycle === "ANNUAL" ? "annual" : "monthly"})
        </span>
      </span>
    ),
  },
  { id: "date", header: "Requested", cell: (r) => formatDate(r.createdAt) },
  {
    id: "status",
    header: "Status",
    cell: (r) => (
      <StatusBadge tone={TONE[r.status]} dot>
        {label(r.status)}
      </StatusBadge>
    ),
  },
];

function periodEndFor(cycle: "MONTHLY" | "ANNUAL"): string {
  const d = new Date();
  if (cycle === "ANNUAL") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function ApproveDialog({
  request,
  open,
  onOpenChange,
}: {
  request: UpgradeRequestDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const approve = useUpgradeAction<{ billingCycle: string; periodEnd: string; note?: string }>(
    request.id,
    "approve",
  );
  const [cycle, setCycle] = useState<"MONTHLY" | "ANNUAL">(request.billingCycle);
  const [periodEnd, setPeriodEnd] = useState(periodEndFor(request.billingCycle));
  const [note, setNote] = useState("");
  const { pending, run, err } = useAction();
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve upgrade to {request.requestedPlan.name}?</DialogTitle>
          <DialogDescription>
            This activates the plan for {request.workspaceName} immediately and notifies the owner.
            Confirm that payment has been received first.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <FormField label="Billing cycle" error={err("billingCycle")}>
            <Select
              value={cycle}
              onValueChange={(v) => {
                setCycle(v as "MONTHLY" | "ANNUAL");
                setPeriodEnd(periodEndFor(v as "MONTHLY" | "ANNUAL"));
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MONTHLY">Monthly</SelectItem>
                <SelectItem value="ANNUAL">Annual</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Valid until (last paid day)" required error={err("periodEnd")}>
            <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
          </FormField>
          <FormField label="Note (optional)" error={err("note")}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={async () => {
              const ok = await run(() =>
                approve.mutateAsync({ billingCycle: cycle, periodEnd, note: note || undefined }),
              );
              if (ok) {
                toast.success(
                  `${request.requestedPlan.name} plan activated for ${request.workspaceName}`,
                );
                onOpenChange(false);
              }
            }}
          >
            {pending && <Spinner decorative />} Approve &amp; activate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NoteForm({ requestId }: { requestId: string }) {
  const addNote = useUpgradeAction<{ body: string }>(requestId, "notes");
  const [body, setBody] = useState("");
  const { pending, run, err } = useAction();
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => addNote.mutateAsync({ body }))) {
          setBody("");
          toast.success("Note added");
        }
      }}
    >
      <FormField
        label="Internal note"
        description="Only Super Admins can see notes."
        error={err("body")}
      >
        <Textarea
          rows={2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={1000}
        />
      </FormField>
      <Button
        type="submit"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={pending || !body.trim()}
      >
        Add note
      </Button>
    </form>
  );
}

function RequestDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useUpgradeRequest(id);
  const reject = useUpgradeAction<{ reason: string }>(id, "reject");
  const [dialog, setDialog] = useState<"approve" | "reject" | null>(null);
  if (q.isPending) return <p className="p-4 text-sm text-muted-foreground">Loading request…</p>;
  if (q.isError) {
    return (
      <ErrorState size="compact" message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
    );
  }
  const r = q.data;
  return (
    <>
      <SheetHeader>
        <SheetTitle>{r.workspaceName}</SheetTitle>
        <SheetDescription>
          {r.currentPlan?.name ?? "No plan"} → {r.requestedPlan.name} ·{" "}
          {r.requestedPlan.monthlyPrice !== null
            ? `${formatPrice(r.requestedPlan.monthlyPrice, r.requestedPlan.currency)} / month`
            : "Custom pricing"}
        </SheetDescription>
      </SheetHeader>
      <SheetBody className="flex flex-col gap-5 overflow-y-auto">
        <div className="flex items-center gap-2">
          <StatusBadge tone={TONE[r.status]} dot>
            {label(r.status)}
          </StatusBadge>
          <Badge variant="outline">{r.billingCycle === "ANNUAL" ? "Annual" : "Monthly"}</Badge>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Requested by</dt>
          <dd>{r.requestedBy ? `${r.requestedBy.name} (${r.requestedBy.email})` : "—"}</dd>
          <dt className="text-muted-foreground">Requested</dt>
          <dd>{formatDate(r.createdAt)}</dd>
          <dt className="text-muted-foreground">Current subscription</dt>
          <dd>
            {r.currentSubscription
              ? `${r.currentSubscription.planName} · ${label(r.currentSubscription.status)}${
                  r.currentSubscription.currentPeriodEnd
                    ? ` until ${formatDate(r.currentSubscription.currentPeriodEnd)}`
                    : r.currentSubscription.trialEndsAt
                      ? ` (trial ends ${formatDate(r.currentSubscription.trialEndsAt)})`
                      : ""
                }`
              : "None"}
          </dd>
          {r.message && (
            <>
              <dt className="text-muted-foreground">Message</dt>
              <dd>{r.message}</dd>
            </>
          )}
          {r.decidedAt && (
            <>
              <dt className="text-muted-foreground">Decided</dt>
              <dd>
                {formatDate(r.decidedAt)} by {r.decidedByName ?? "—"}
                {r.decisionReason ? ` — ${r.decisionReason}` : ""}
              </dd>
            </>
          )}
        </dl>
        {r.status === "PENDING" && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setDialog("approve")}>Approve…</Button>
            <Button variant="outline" onClick={() => setDialog("reject")}>
              Reject…
            </Button>
          </div>
        )}
        <section aria-label="History" className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">History</h3>
          <ol className="flex flex-col gap-2 border-l pl-4 text-sm">
            {r.events.map((e) => (
              <li key={e.id}>
                <p>
                  <strong>{label(e.type === "NOTE" ? "Internal note" : e.type)}</strong>
                  <span className="text-muted-foreground">
                    {" "}
                    · {e.actorName ?? "System"} · {formatDate(e.createdAt)}
                  </span>
                </p>
                {e.body && <p className="text-muted-foreground">{e.body}</p>}
              </li>
            ))}
          </ol>
        </section>
        <NoteForm requestId={id} />
      </SheetBody>
      <ApproveDialog
        request={r}
        open={dialog === "approve"}
        onOpenChange={(o) => setDialog(o ? "approve" : null)}
      />
      <ReasonConfirmDialog
        open={dialog === "reject"}
        onOpenChange={(o) => setDialog(o ? "reject" : null)}
        title={`Reject the ${r.requestedPlan.name} request?`}
        description="The owner is notified with your reason. Their subscription stays unchanged."
        confirmLabel="Reject request"
        destructive
        successMessage="Request rejected"
        onConfirm={async (reason) => {
          await reject.mutateAsync({ reason });
          onClose();
        }}
      />
    </>
  );
}

/** /admin/upgrade-requests */
export function AdminUpgradeRequestsPage() {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<UpgradeListFilters>({ page: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const q = useDebouncedValue(search.trim());
  const list = useUpgradeRequests({ ...filters, search: q || undefined });
  const pageCount = list.data ? Math.ceil(list.data.total / list.data.pageSize) : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Upgrade requests"
        description={
          list.data
            ? `${list.data.pendingCount} pending · ${list.data.total} shown`
            : "Plan changes requested by workspace owners."
        }
      />
      <FilterBar>
        <SearchInput
          aria-label="Search upgrade requests"
          placeholder="Workspace or requester"
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
              status: v === "all" ? undefined : (v as UpgradeStatus),
            }))
          }
        >
          <SelectTrigger aria-label="Request status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {UPGRADE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {label(s)}
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
          aria-label="Upgrade requests"
          columns={columns}
          rows={list.data?.items ?? []}
          rowKey="id"
          loading={list.isPending}
          onRowClick={(r) => setSelected(r.id)}
          rowLabel={(r) => `Open request from ${r.workspaceName}`}
          empty={
            <EmptyState
              headingLevel={2}
              size="compact"
              icon={<ArrowUpCircle />}
              title="No upgrade requests"
              description={
                filters.status || q
                  ? "Nothing matches these filters. Try clearing them."
                  : "When a workspace owner asks for a plan change it will show up here."
              }
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
      <Sheet open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-[min(100%-1rem,36rem)] sm:max-w-none">
          {selected && <RequestDetail id={selected} onClose={() => setSelected(null)} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
