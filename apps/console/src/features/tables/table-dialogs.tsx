"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

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

import { useBulkCreateTables, useCreateTable, useUpdateTable } from "./queries";

type TableValues = z.input<typeof createTableSchema>;
type TableOutput = z.output<typeof createTableSchema>;

export function TableDialog({
  open,
  onOpenChange,
  branchId,
  table,
  sections,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
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
  table,
  sections,
  onDone,
}: {
  branchId: string;
  table: TableDto | null;
  sections: string[];
  onDone: () => void;
}) {
  const create = useCreateTable(branchId);
  const update = useUpdateTable();
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
      if (!applyFieldErrors(error, setError, ["name", "capacity", "section", "isActive"])) {
        toast.error(errorMessage(error));
      }
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{table ? `Edit ${table.name}` : "Add a table"}</DialogTitle>
        <DialogDescription>Names must be unique within this branch.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Name" error={errors.name?.message} required>
          <Input {...register("name")} placeholder="e.g. T12" autoFocus />
        </FormField>
        <FormField label="Seats" error={errors.capacity?.message} required>
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
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner decorative />}
          {table ? "Save" : "Add table"}
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && <BulkForm branchId={branchId} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function BulkForm({ branchId, onDone }: { branchId: string; onDone: () => void }) {
  const bulk = useBulkCreateTables(branchId);
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

  const onSubmit = handleSubmit(async (values) => {
    try {
      const created = await bulk.mutateAsync(values);
      toast.success(`${created.length} tables added`);
      onDone();
    } catch (error) {
      if (!applyFieldErrors(error, setError, ["prefix", "from", "to", "capacity", "section"])) {
        toast.error(errorMessage(error));
      }
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Add several tables</DialogTitle>
        <DialogDescription>
          Creates a numbered series, e.g. T1 to T10. Up to {MAX_BULK_TABLES} at once.
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-3 gap-3">
        <FormField label="Prefix" error={errors.prefix?.message}>
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
        <FormField label="Section" error={errors.section?.message}>
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
          "Enter a valid range to preview the names."
        )}
      </p>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Spinner decorative />}
          Add tables
        </Button>
      </DialogFooter>
    </form>
  );
}
