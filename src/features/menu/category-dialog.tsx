"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { Button } from "@/components/ui/button";
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
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createCategorySchema, type MenuCategoryDto } from "@/contracts/menu";
import { applyFieldErrors, errorMessage } from "@/lib/api-client";

import { useCreateCategory, useUpdateCategory } from "./queries";

type Values = z.input<typeof createCategorySchema>;
type Output = z.output<typeof createCategorySchema>;

export function CategoryDialog({
  open,
  onOpenChange,
  restaurantId,
  category,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restaurantId: string;
  /** null = create */
  category: MenuCategoryDto | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && (
          <CategoryForm
            key={category?.id ?? "new"}
            restaurantId={restaurantId}
            category={category}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CategoryForm({
  restaurantId,
  category,
  onDone,
}: {
  restaurantId: string;
  category: MenuCategoryDto | null;
  onDone: () => void;
}) {
  const create = useCreateCategory(restaurantId);
  const update = useUpdateCategory();
  const form = useForm<Values, unknown, Output>({
    resolver: zodResolver(createCategorySchema),
    defaultValues: {
      name: category?.name ?? "",
      description: category?.description ?? "",
      isVisible: category?.isVisible ?? true,
    },
  });
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (category) {
        await update.mutateAsync({ id: category.id, ...values, version: category.version });
        toast.success("Category saved");
      } else {
        await create.mutateAsync(values);
        toast.success(`${values.name} added`);
      }
      onDone();
    } catch (error) {
      if (!applyFieldErrors(error, setError, ["name", "description", "isVisible"])) {
        toast.error(errorMessage(error));
      }
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{category ? "Edit category" : "New category"}</DialogTitle>
        <DialogDescription>Categories group items on every branch&apos;s menu.</DialogDescription>
      </DialogHeader>
      <FormField label="Name" error={errors.name?.message} required>
        <Input {...register("name")} placeholder="e.g. Starters" autoFocus />
      </FormField>
      <FormField label="Description" error={errors.description?.message}>
        <Textarea {...register("description")} rows={2} placeholder="Optional, shown to guests" />
      </FormField>
      <Controller
        control={control}
        name="isVisible"
        render={({ field }) => (
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
            <span>
              <span className="font-medium">Visible to guests</span>
              <span className="block text-muted-foreground">
                Hidden categories stay editable but don&apos;t appear on menus.
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
          {category ? "Save" : "Add category"}
        </Button>
      </DialogFooter>
    </form>
  );
}
