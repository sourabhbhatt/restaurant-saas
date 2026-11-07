"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { FormError } from "@ros/ui/shared/feedback";
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
import { Spinner } from "@ros/ui/ui/spinner";
import { Switch } from "@ros/ui/ui/switch";
import {
  bulkCreateTablesSchema,
  bulkTableNames,
  createTableSchema,
  MAX_BULK_TABLES,
  type TableDto,
} from "@ros/contracts/tables";
import { applyFieldErrors, errorMessage } from "@ros/api-client";
import { PlanErrorNotice, usePlanError } from "@ros/web-core/features/subscriptions/limit-notice";

import { useBulkCreateTables, useCreateTable, useUpdateTable } from "./queries";

type TableValues = z.input<typeof createTableSchema>;
type TableOutput = z.output<typeof createTableSchema>;

export function TableDialog({
  open,
  onOpenChange,
  branchId,
  workspaceId,
  table,
  sections,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
  workspaceId: string;
  /** null = create */
  table: TableDto | null;
  sections: string[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && (
          <TableForm
            key={table?.id ?? "new"}
            branchId={branchId}
            workspaceId={workspaceId}
            table={table}
            sections={sections}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TableForm({
  branchId,
  workspaceId,
  table,
  sections,
  onDone,
}: {
  branchId: string;
  workspaceId: string;
  table: TableDto | null;
  sections: string[];
  onDone: () => void;
}) {
  const create = useCreateTable(branchId);
  const update = useUpdateTable();
  const plan = usePlanError(workspaceId);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<TableValues, unknown, TableOutput>({
    resolver: zodResolver(createTableSchema),
    defaultValues: {
      name: table?.name ?? "",
      capacity: table?.capacity ?? 4,
      section: table?.section ?? "",
      isActive: table?.isActive ?? true,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    plan.clear();
    try {
      if (table) {
        await update.mutateAsync({ id: table.id, ...values, version: table.version });
        toast.success(`${values.name} saved`);
      } else {
        await create.mutateAsync(values);
        toast.success(`${values.name} added`);
      }
      onDone();
    } catch (error) {
      if (plan.capture(error)) return;
      if (!applyFieldErrors(error, setError, ["name", "capacity", "section", "isActive"])) {
        setError("root.server", { type: "server", message: errorMessage(error) });
      }
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{table ? `Edit ${table.name}` : "Add table"}</DialogTitle>
        <DialogDescription>
          {table
            ? "Changes apply right away. The table's QR code stays the same."
            : "The table gets its own QR code, which guests scan to order."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Name"
          description="Unique within this branch."
          error={errors.name?.message}
          required
        >
          <Input {...register("name")} placeholder="e.g. T12" autoFocus />
        </FormField>
        <FormField label="Seats" description="1 to 100." error={errors.capacity?.message} required>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            {...register("capacity", { valueAsNumber: true })}
          />
        </FormField>
      </div>
      <FormField
        label="Section"
        error={errors.section?.message}
        description="Optional, e.g. Patio, First floor."
      >
        <Input {...register("section")} list="table-sections" placeholder="No section" />
      </FormField>
      <datalist id="table-sections">
        {sections.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <Controller
        control={control}
        name="isActive"
        render={({ field }) => (
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
            <span>
              <span className="font-medium">In service</span>
              <span className="block text-muted-foreground">
                Out-of-service tables show as closed and can&apos;t start new orders.
              </span>
            </span>
            <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
          </label>
        )}
      />
      <PlanErrorNotice error={plan.error} workspaceId={workspaceId} />
      <FormError>{errors.root?.server?.message}</FormError>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner decorative />}
          {table ? "Save table" : "Add table"}
        </Button>
      </DialogFooter>
    </form>
  );
}

type BulkValues = z.input<typeof bulkCreateTablesSchema>;
type BulkOutput = z.output<typeof bulkCreateTablesSchema>;

export function BulkTablesDialog({
  open,
  onOpenChange,
  branchId,
  workspaceId,
  remaining,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
  workspaceId: string;
  /** Tables the plan still allows; null = unlimited or not known yet. */
  remaining: number | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && (
          <BulkForm
            branchId={branchId}
            workspaceId={workspaceId}
            remaining={remaining}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function BulkForm({
  branchId,
  workspaceId,
  remaining,
  onDone,
}: {
  branchId: string;
  workspaceId: string;
  remaining: number | null;
  onDone: () => void;
}) {
  const bulk = useBulkCreateTables(branchId);
  const plan = usePlanError(workspaceId);
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<BulkValues, unknown, BulkOutput>({
    resolver: zodResolver(bulkCreateTablesSchema),
    defaultValues: { prefix: "T", from: 1, to: 10, capacity: 4, section: "" },
  });
  const [prefix, from, to] = useWatch({ control, name: ["prefix", "from", "to"] });
  const valid =
    Number.isInteger(from) && Number.isInteger(to) && to >= from && to - from < MAX_BULK_TABLES;
  const preview = valid ? bulkTableNames({ prefix: prefix ?? "", from, to }) : [];
  const overPlan = remaining !== null && preview.length > remaining;

  const onSubmit = handleSubmit(async (values) => {
    plan.clear();
    try {
      const created = await bulk.mutateAsync(values);
      toast.success(`${created.length} tables added`);
      onDone();
    } catch (error) {
      if (plan.capture(error)) return;
      if (!applyFieldErrors(error, setError, ["prefix", "from", "to", "capacity", "section"])) {
        setError("root.server", { type: "server", message: errorMessage(error) });
      }
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Add several tables</DialogTitle>
        <DialogDescription>
          Creates a numbered series, e.g. T1 to T10. Up to {MAX_BULK_TABLES} at once; names that
          already exist at this branch are rejected.
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-3 gap-3">
        <FormField label="Prefix" description="Optional." error={errors.prefix?.message}>
          <Input {...register("prefix")} placeholder="T" />
        </FormField>
        <FormField label="From" error={errors.from?.message} required>
          <Input type="number" inputMode="numeric" {...register("from", { valueAsNumber: true })} />
        </FormField>
        <FormField label="To" error={errors.to?.message} required>
          <Input type="number" inputMode="numeric" {...register("to", { valueAsNumber: true })} />
        </FormField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Seats each" error={errors.capacity?.message} required>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            {...register("capacity", { valueAsNumber: true })}
          />
        </FormField>
        <FormField
          label="Section"
          description="Optional, e.g. Patio."
          error={errors.section?.message}
        >
          <Input {...register("section")} placeholder="No section" />
        </FormField>
      </div>
      <p className="rounded-lg border bg-muted/40 p-3 text-sm" aria-live="polite">
        {preview.length > 0 ? (
          <>
            Creates <span className="font-semibold">{preview.length}</span> tables:{" "}
            {preview.length <= 6
              ? preview.join(", ")
              : `${preview.slice(0, 3).join(", ")} … ${preview.slice(-2).join(", ")}`}
          </>
        ) : (
          `Enter a range where "To" is at least "From" and covers at most ${MAX_BULK_TABLES} tables to preview the names.`
        )}
        {remaining !== null ? (
          <span className="mt-1 block text-muted-foreground">
            Your plan has room for {remaining.toLocaleString("en-IN")} more table
            {remaining === 1 ? "" : "s"} in this workspace.
          </span>
        ) : null}
      </p>
      {overPlan ? (
        <FormError id="bulk-over-plan">
          That&apos;s {preview.length} tables, but your plan allows only {remaining} more. Shorten
          the range or upgrade your plan.
        </FormError>
      ) : null}
      <PlanErrorNotice error={plan.error} workspaceId={workspaceId} />
      <FormError>{errors.root?.server?.message}</FormError>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isSubmitting || overPlan}
          aria-describedby={overPlan ? "bulk-over-plan" : undefined}
        >
          {isSubmitting && <Spinner decorative />}
          {preview.length > 0 ? `Add ${preview.length} tables` : "Add tables"}
        </Button>
      </DialogFooter>
    </form>
  );
}
