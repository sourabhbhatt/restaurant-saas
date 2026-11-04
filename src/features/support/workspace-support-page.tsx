"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LifeBuoy, Plus } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import {
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  PageSkeleton,
} from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  createSupportRequestSchema,
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_STATUSES,
  type CreateSupportRequestInput,
  type SupportStatus,
} from "@/contracts/platform";
import { formatDateTime } from "@/features/subscriptions/subscription-ui";
import { applyFieldErrors, errorMessage } from "@/lib/api-client";

import { useCreateSupportRequest, useWorkspaceSupport } from "./queries";
import {
  categoryLabel,
  SUPPORT_PRIORITY_LABEL,
  SUPPORT_STATUS_LABEL,
  SupportPriorityBadge,
  SupportStatusBadge,
} from "./support-ui";

type FormOutput = z.output<typeof createSupportRequestSchema>;
const FIELDS = ["subject", "message", "category", "priority"] as const;

function NewRequestDialog({
  workspaceId,
  open,
  onOpenChange,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateSupportRequest(workspaceId);
  const form = useForm<CreateSupportRequestInput, unknown, FormOutput>({
    resolver: zodResolver(createSupportRequestSchema),
    defaultValues: { subject: "", message: "", category: "GENERAL", priority: "NORMAL" },
  });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await create.mutateAsync(values);
      toast.success("Request sent. We'll reply by email.");
      form.reset();
      onOpenChange(false);
    } catch (error) {
      if (applyFieldErrors(error, form.setError, FIELDS)) return;
      toast.error(errorMessage(error));
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (create.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form className="grid gap-4" onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>New support request</DialogTitle>
            <DialogDescription>
              Our team replies to your account email, usually within one business day.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller
              control={form.control}
              name="category"
              render={({ field, fieldState }) => (
                <FormField label="Category" error={fieldState.error?.message} required>
                  {(controlProps) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger {...controlProps} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SUPPORT_CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {SUPPORT_CATEGORY_LABELS[c]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
              )}
            />
            <Controller
              control={form.control}
              name="priority"
              render={({ field, fieldState }) => (
                <FormField label="Priority" error={fieldState.error?.message}>
                  {(controlProps) => (
                    <Select value={field.value ?? "NORMAL"} onValueChange={field.onChange}>
                      <SelectTrigger {...controlProps} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(["LOW", "NORMAL", "HIGH"] as const).map((p) => (
                          <SelectItem key={p} value={p}>
                            {SUPPORT_PRIORITY_LABEL[p]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
              )}
            />
          </div>
          <FormField label="Subject" error={errors.subject?.message} required>
            <Input maxLength={140} placeholder="Short summary" {...form.register("subject")} />
          </FormField>
          <FormField label="Message" error={errors.message?.message} required>
            <Textarea
              rows={5}
              maxLength={5000}
              placeholder="What happened, and what did you expect?"
              {...form.register("message")}
            />
          </FormField>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Spinner decorative />}
              Send request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** /app/w/[workspaceId]/support */
export function WorkspaceSupportPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [status, setStatus] = useState<SupportStatus | undefined>();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const list = useWorkspaceSupport(workspaceId, { status, page });

  if (list.isPending) return <PageSkeleton variant="list" />;
  if (list.isError) {
    return (
      <ErrorState
        title="We couldn't load support requests"
        message={errorMessage(list.error)}
        onRetry={() => void list.refetch()}
        retrying={list.isFetching}
      />
    );
  }
  const d = list.data;
  const pageCount = Math.ceil(d.total / d.pageSize);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Support"
        description={
          d.canCreate
            ? "Ask our team for help, report a problem or request a plan change."
            : "Requests you have sent to the platform team."
        }
        actions={
          d.canCreate ? (
            <Button onClick={() => setOpen(true)}>
              <Plus aria-hidden /> New request
            </Button>
          ) : null
        }
      />
      <FilterBar>
        <Select
          value={status ?? "all"}
          onValueChange={(v) => {
            setStatus(v === "all" ? undefined : (v as SupportStatus));
            setPage(1);
          }}
        >
          <SelectTrigger aria-label="Filter by status">
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
      </FilterBar>
      {d.items.length === 0 ? (
        <EmptyState
          icon={<LifeBuoy />}
          title={status ? "No requests with this status" : "No support requests yet"}
          description={
            d.canCreate
              ? "When you need help, send a request and track its progress here."
              : "Only workspace owners and admins can open support requests."
          }
          action={
            d.canCreate && !status ? (
              <Button onClick={() => setOpen(true)}>
                <Plus aria-hidden /> New request
              </Button>
            ) : null
          }
        />
      ) : (
        <ul className="grid gap-3" aria-busy={list.isFetching || undefined}>
          {d.items.map((r) => (
            <li key={r.id}>
              <Card className="gap-3 px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="min-w-0 flex-1 truncate font-medium">{r.subject}</h3>
                  <SupportPriorityBadge priority={r.priority} />
                  <SupportStatusBadge status={r.status} />
                </div>
                <p className="line-clamp-3 text-sm whitespace-pre-line text-muted-foreground">
                  {r.message}
                </p>
                <p className="text-xs text-muted-foreground">
                  {categoryLabel(r.category)} · {formatDateTime(r.createdAt)}
                  {r.createdBy ? ` · ${r.createdBy.name}` : ""}
                  {r.resolvedAt ? ` · resolved ${formatDateTime(r.resolvedAt)}` : ""}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {pageCount > 1 ? (
        <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
      ) : null}
      {d.canCreate ? (
        <NewRequestDialog workspaceId={workspaceId} open={open} onOpenChange={setOpen} />
      ) : null}
    </div>
  );
}
