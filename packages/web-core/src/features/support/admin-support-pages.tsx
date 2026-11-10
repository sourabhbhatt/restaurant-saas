"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, LifeBuoy, UserCheck, UserMinus } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import {
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  PageSkeleton,
  type DataTableColumn,
} from "@ros/ui/shared/feedback";
import { Button } from "@ros/ui/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ros/ui/ui/card";
import { FormField } from "@ros/ui/ui/form-field";
import { Pagination } from "@ros/ui/ui/pagination";
import { SearchInput } from "@ros/ui/ui/search-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ros/ui/ui/select";
import { Spinner } from "@ros/ui/ui/spinner";
import { Textarea } from "@ros/ui/ui/textarea";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
  supportNoteSchema,
  type SupportCategory,
  type SupportPriority,
  type SupportRequestDto,
  type SupportStatus,
} from "@ros/contracts/platform";
import { formatDateTime } from "../subscriptions/subscription-ui";
import { useMe } from "../session/queries";
import { useDebouncedValue } from "../superadmin/use-debounced-value";
import { applyFieldErrors, errorMessage } from "@ros/api-client";

import {
  useAddSupportNote,
  useAdminSupportList,
  useAdminSupportRequest,
  useUpdateSupportRequest,
  type AdminSupportFilters,
} from "./queries";
import {
  categoryLabel,
  SUPPORT_PRIORITY_LABEL,
  SUPPORT_STATUS_LABEL,
  SupportPriorityBadge,
  SupportStatusBadge,
} from "./support-ui";

const columns: DataTableColumn<SupportRequestDto>[] = [
  {
    id: "subject",
    header: "Request",
    cell: (r) => (
      <div className="flex min-w-0 flex-col">
        <span className="max-w-xs truncate font-medium">{r.subject}</span>
        <span className="text-xs text-muted-foreground">
          {r.workspaceName ?? "—"} · {r.contactEmail}
        </span>
      </div>
    ),
  },
  { id: "category", header: "Category", cell: (r) => categoryLabel(r.category) },
  {
    id: "priority",
    header: "Priority",
    cell: (r) => <SupportPriorityBadge priority={r.priority} />,
  },
  { id: "status", header: "Status", cell: (r) => <SupportStatusBadge status={r.status} /> },
  { id: "assignee", header: "Assignee", cell: (r) => r.assignedTo?.name ?? "—" },
  {
    id: "created",
    header: "Created",
    cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.createdAt)}</span>,
  },
];

/** /admin/support */
export function AdminSupportListPage() {
  const router = useRouter();
  const [filters, setFilters] = useState<AdminSupportFilters>({ page: 1 });
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim());
  const list = useAdminSupportList({ ...filters, q: q || undefined });
  const set = (patch: Partial<AdminSupportFilters>) =>
    setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
  const pageCount = list.data ? Math.ceil(list.data.total / list.data.pageSize) : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Support requests" description="Requests from every workspace." />
      <FilterBar>
        <SearchInput
          placeholder="Search subject, email or workspace"
          aria-label="Search requests"
          value={search}
          onValueChange={(v) => {
            setSearch(v);
            set({});
          }}
        />
        <Select
          value={filters.status ?? "all"}
          onValueChange={(v) => set({ status: v === "all" ? undefined : (v as SupportStatus) })}
        >
          <SelectTrigger aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {SUPPORT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {SUPPORT_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.category ?? "all"}
          onValueChange={(v) => set({ category: v === "all" ? undefined : (v as SupportCategory) })}
        >
          <SelectTrigger aria-label="Category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {SUPPORT_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {SUPPORT_CATEGORY_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.priority ?? "all"}
          onValueChange={(v) => set({ priority: v === "all" ? undefined : (v as SupportPriority) })}
        >
          <SelectTrigger aria-label="Priority">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            {SUPPORT_PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {SUPPORT_PRIORITY_LABEL[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.assigned ?? "all"}
          onValueChange={(v) =>
            set({ assigned: v === "all" ? undefined : (v as "me" | "unassigned") })
          }
        >
          <SelectTrigger aria-label="Assignment">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Anyone</SelectItem>
            <SelectItem value="me">Assigned to me</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
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
          aria-label="Support requests"
          columns={columns}
          rows={list.data?.items ?? []}
          rowKey="id"
          loading={list.isPending}
          onRowClick={(r) => router.push(`/admin/support/${r.id}`)}
          rowLabel={(r) => `Open request ${r.subject}`}
          empty={
            <EmptyState
              size="compact"
              icon={<LifeBuoy />}
              title="No requests match"
              description="Try clearing filters."
            />
          }
        />
      )}
      {pageCount > 1 ? (
        <Pagination
          page={filters.page}
          pageCount={pageCount}
          onPageChange={(page) => set({ page })}
        />
      ) : null}
    </div>
  );
}

type NoteForm = z.infer<typeof supportNoteSchema>;

function NotesPanel({
  id,
  notes,
}: {
  id: string;
  notes: { id: string; body: string; author: { name: string } | null; createdAt: string }[];
}) {
  const add = useAddSupportNote(id);
  const form = useForm<NoteForm>({
    resolver: zodResolver(supportNoteSchema),
    defaultValues: { body: "" },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await add.mutateAsync(values);
      form.reset();
      toast.success("Note added");
    } catch (error) {
      if (applyFieldErrors(error, form.setError, ["body"])) return;
      toast.error(errorMessage(error));
    }
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Internal notes</CardTitle>
        <p className="text-sm text-muted-foreground">Visible to Super Admins only.</p>
      </CardHeader>
      <CardContent className="grid gap-4">
        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
        ) : (
          <ol className="grid gap-3">
            {notes.map((n) => (
              <li key={n.id} className="rounded-lg border bg-muted/30 p-3">
                <p className="text-sm whitespace-pre-line">{n.body}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {n.author?.name ?? "Unknown"} · {formatDateTime(n.createdAt)}
                </p>
              </li>
            ))}
          </ol>
        )}
        <form className="grid gap-3" onSubmit={onSubmit} noValidate>
          <FormField label="Add a note" error={form.formState.errors.body?.message} hideLabel>
            <Textarea rows={3} placeholder="Add an internal note…" {...form.register("body")} />
          </FormField>
          <div>
            <Button type="submit" size="sm" disabled={add.isPending}>
              {add.isPending && <Spinner decorative />}
              Add note
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** /admin/support/[requestId] */
export function AdminSupportDetailPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const me = useMe();
  const detail = useAdminSupportRequest(requestId);
  const update = useUpdateSupportRequest(requestId);

  const change = async (body: Parameters<typeof update.mutateAsync>[0], done: string) => {
    try {
      await update.mutateAsync(body);
      toast.success(done);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (detail.isPending) return <PageSkeleton variant="detail" />;
  if (detail.isError) {
    return (
      <ErrorState
        title="Request unavailable"
        message={errorMessage(detail.error)}
        onRetry={() => void detail.refetch()}
      />
    );
  }
  const r = detail.data;
  const mine = r.assignedTo?.id === me.data?.user.id;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={
          <Link href="/admin/support" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft className="size-3.5" aria-hidden /> Support requests
          </Link>
        }
        title={r.subject}
        description={`${categoryLabel(r.category)} · opened ${formatDateTime(r.createdAt)}`}
        actions={
          mine ? (
            <Button
              variant="outline"
              disabled={update.isPending}
              onClick={() => void change({ assignee: null }, "Unassigned")}
            >
              <UserMinus aria-hidden /> Unassign
            </Button>
          ) : (
            <Button
              disabled={update.isPending}
              onClick={() => void change({ assignee: "me" }, "Assigned to you")}
            >
              <UserCheck aria-hidden /> Assign to me
            </Button>
          )
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Message</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-line">{r.message}</p>
            </CardContent>
          </Card>
          <NotesPanel id={r.id} notes={r.notes} />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            <div className="grid gap-2">
              <span className="text-muted-foreground" id="status-label">
                Status
              </span>
              <Select
                value={r.status}
                disabled={update.isPending}
                onValueChange={(v) => void change({ status: v as SupportStatus }, "Status updated")}
              >
                <SelectTrigger aria-labelledby="status-label" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {SUPPORT_STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <span className="text-muted-foreground" id="priority-label">
                Priority
              </span>
              <Select
                value={r.priority}
                disabled={update.isPending}
                onValueChange={(v) =>
                  void change({ priority: v as SupportPriority }, "Priority updated")
                }
              >
                <SelectTrigger aria-labelledby="priority-label" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORT_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {SUPPORT_PRIORITY_LABEL[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <dl className="grid gap-3">
              <div>
                <dt className="text-muted-foreground">Workspace</dt>
                <dd className="font-medium">
                  {r.workspaceId ? (
                    <Link className="hover:underline" href={`/admin/workspaces/${r.workspaceId}`}>
                      {r.workspaceName ?? r.workspaceId}
                    </Link>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Requested by</dt>
                <dd className="font-medium">
                  {r.createdBy?.name ?? "—"}{" "}
                  <a
                    className="block font-normal text-primary hover:underline"
                    href={`mailto:${r.contactEmail}`}
                  >
                    {r.contactEmail}
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Assignee</dt>
                <dd className="font-medium">{r.assignedTo?.name ?? "Unassigned"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Resolved</dt>
                <dd className="font-medium">{r.resolvedAt ? formatDateTime(r.resolvedAt) : "—"}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
