"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type Control,
  type FieldErrors,
  type UseFormRegister,
} from "react-hook-form";
import { toast } from "sonner";

import { ConfirmDialog, FormError } from "@ros/ui/shared/feedback";
import { Badge } from "@ros/ui/ui/badge";
import { Button } from "@ros/ui/ui/button";
import { Checkbox } from "@ros/ui/ui/checkbox";
import { FormField } from "@ros/ui/ui/form-field";
import { Input } from "@ros/ui/ui/input";
import { Label } from "@ros/ui/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ros/ui/ui/select";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@ros/ui/ui/sheet";
import { Spinner } from "@ros/ui/ui/spinner";
import { Switch } from "@ros/ui/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ros/ui/ui/tabs";
import { Textarea } from "@ros/ui/ui/textarea";
import {
  ALLERGEN_LABELS,
  DIETARY_LABELS,
  createItemSchema,
  type BranchOverrideDto,
  type CreateItemData,
  type CreateItemInput,
  type MenuCategoryDto,
  type MenuItemDto,
} from "@ros/contracts/menu";
import {
  ALLERGENS,
  DIETARY_TYPES,
  priceSelection,
  startingPrice,
  type PricedItem,
} from "@ros/domain/menu/pricing";
import { DomainError } from "@ros/domain/shared/errors";
import { formatMoney } from "@ros/domain/shared/money";
import { ApiError, applyFieldErrors, errorMessage } from "@ros/api-client";
import { PlanErrorNotice, usePlanError } from "@ros/web-core/features/subscriptions/limit-notice";
import { cn } from "@ros/ui/utils";

import { BranchPricingPanel } from "./branch-pricing-panel";
import { ImageUpload } from "./image-upload";
import { MoneyInput } from "./menu-ui";
import { useCreateItem, useDeleteItem, useUpdateItem } from "./queries";

type Values = CreateItemInput;
type TabKey = "details" | "variants" | "addons" | "branch";

const TOP_FIELDS = [
  "categoryId",
  "name",
  "description",
  "price",
  "discountedPrice",
  "dietary",
  "allergens",
  "prepTimeMinutes",
  "imageKey",
  "variants",
  "addonGroups",
];

function defaults(item: MenuItemDto | null, categoryId: string | undefined): Values {
  if (!item) {
    return {
      categoryId: categoryId ?? "",
      name: "",
      description: "",
      price: Number.NaN,
      discountedPrice: null,
      dietary: "VEG",
      allergens: [],
      prepTimeMinutes: 15,
      isAvailable: true,
      isFeatured: false,
      imageKey: null,
      variants: [],
      addonGroups: [],
    };
  }
  return {
    categoryId: item.categoryId,
    name: item.name,
    description: item.description ?? "",
    price: item.price,
    discountedPrice: item.discountedPrice,
    dietary: item.dietary,
    allergens: item.allergens,
    prepTimeMinutes: item.prepTimeMinutes,
    isAvailable: item.isAvailable,
    isFeatured: item.isFeatured,
    imageKey: item.imageKey,
    variants: item.variants.map((v) => ({
      id: v.id,
      name: v.name,
      price: v.price,
      isDefault: v.isDefault,
      isAvailable: v.isAvailable,
    })),
    addonGroups: item.addonGroups.map((g) => ({
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      addons: g.addons.map((a) => ({
        id: a.id,
        name: a.name,
        price: a.price,
        isAvailable: a.isAvailable,
      })),
    })),
  };
}

function tabForError(errors: FieldErrors<Values>): TabKey {
  if (errors.variants) return "variants";
  if (errors.addonGroups) return "addons";
  return "details";
}

export interface ItemEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create */
  item: MenuItemDto | null;
  categories: MenuCategoryDto[];
  defaultCategoryId?: string;
  restaurantId: string;
  workspaceId: string;
  branchId: string;
  branchName: string;
  currency: string;
  override: BranchOverrideDto | null;
  canManageBranch: boolean;
}

/** Item editor: Details, Variants, Add-ons and Branch pricing tabs. */
export function ItemEditorSheet(props: ItemEditorProps) {
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-2xl">
        {props.open && <ItemEditorBody key={props.item?.id ?? "new"} {...props} />}
      </SheetContent>
    </Sheet>
  );
}

function ItemEditorBody({
  onOpenChange,
  item,
  categories,
  defaultCategoryId,
  restaurantId,
  workspaceId,
  branchId,
  branchName,
  currency,
  override,
  canManageBranch,
}: ItemEditorProps) {
  const [tab, setTab] = useState<TabKey>("details");
  const [imageUrl, setImageUrl] = useState<string | null>(item?.imageUrl ?? null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const create = useCreateItem(restaurantId);
  const update = useUpdateItem();
  const remove = useDeleteItem();
  const plan = usePlanError(workspaceId);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<Values, unknown, CreateItemData>({
    resolver: zodResolver(createItemSchema),
    defaultValues: defaults(item, defaultCategoryId ?? categories[0]?.id),
    mode: "onTouched",
  });
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  const onSubmit = handleSubmit(
    async (values) => {
      plan.clear();
      setFormError(null);
      try {
        if (item) {
          await update.mutateAsync({ id: item.id, ...values, version: item.version });
          toast.success(`${values.name} saved`);
        } else {
          await create.mutateAsync(values);
          toast.success(`${values.name} added to the menu`);
        }
        onOpenChange(false);
      } catch (error) {
        if (plan.capture(error)) return;
        const known =
          error instanceof ApiError
            ? Object.keys(error.fieldErrors).filter((k) => TOP_FIELDS.includes(k.split(".")[0]!))
            : [];
        if (applyFieldErrors(error, setError, known)) {
          const first = known[0] ?? "";
          setTab(
            first.startsWith("variants")
              ? "variants"
              : first.startsWith("addonGroups")
                ? "addons"
                : "details",
          );
          return;
        }
        setFormError(errorMessage(error));
      }
    },
    (errs) => setTab(tabForError(errs)),
  );

  const variantCount = useWatch({ control, name: "variants" })?.length ?? 0;
  const groupCount = useWatch({ control, name: "addonGroups" })?.length ?? 0;

  return (
    <form onSubmit={onSubmit} noValidate className="flex h-full min-h-0 flex-col">
      <SheetHeader className="border-b">
        <SheetTitle>{item ? `Edit ${item.name}` : "Add menu item"}</SheetTitle>
        <SheetDescription>
          The item appears on the menu of every branch of this restaurant. Prices are shared unless
          a branch overrides them. Fields marked * are required.
        </SheetDescription>
      </SheetHeader>
      <SheetBody className="py-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="gap-4">
          <TabsList className="w-full">
            <TabsTrigger
              value="details"
              aria-invalid={
                tabForError(errors) === "details" && Object.keys(errors).length > 0
                  ? true
                  : undefined
              }
            >
              Details
            </TabsTrigger>
            <TabsTrigger value="variants">
              Variants
              {variantCount > 0 && <Badge variant="secondary">{variantCount}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="addons">
              Add-ons
              {groupCount > 0 && <Badge variant="secondary">{groupCount}</Badge>}
            </TabsTrigger>
            {item && canManageBranch && <TabsTrigger value="branch">Branch pricing</TabsTrigger>}
          </TabsList>

          <TabsContent value="details" className="flex flex-col gap-4">
            <FormField
              label="Photo"
              description="Optional. Shown on the QR menu; counts towards your plan's storage."
              error={errors.imageKey?.message}
            >
              {() => (
                <ImageUpload
                  workspaceId={workspaceId}
                  restaurantId={restaurantId}
                  purpose="menu_item"
                  previewUrl={imageUrl}
                  invalid={Boolean(errors.imageKey)}
                  onChange={(v) => {
                    form.setValue("imageKey", v?.key ?? null, { shouldDirty: true });
                    setImageUrl(v?.url ?? null);
                  }}
                />
              )}
            </FormField>
            <FormField label="Name" error={errors.name?.message} required>
              <Input {...register("name")} placeholder="e.g. Paneer Tikka" />
            </FormField>
            <FormField label="Description" error={errors.description?.message}>
              <Textarea
                {...register("description")}
                placeholder="What makes it special? Shown to guests."
                rows={3}
              />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <Controller
                control={control}
                name="categoryId"
                render={({ field, fieldState }) => (
                  <FormField label="Category" error={fieldState.error?.message} required>
                    {(cp) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger {...cp} className="w-full">
                          <SelectValue placeholder="Choose a category" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </FormField>
                )}
              />
              <Controller
                control={control}
                name="dietary"
                render={({ field, fieldState }) => (
                  <FormField label="Dietary" error={fieldState.error?.message} required>
                    {(cp) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger {...cp} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DIETARY_TYPES.map((d) => (
                            <SelectItem key={d} value={d}>
                              {DIETARY_LABELS[d]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </FormField>
                )}
              />
              <Controller
                control={control}
                name="price"
                render={({ field, fieldState }) => (
                  <FormField
                    label="Price"
                    error={fieldState.error?.message}
                    description={variantCount > 0 ? "Variants set their own prices." : undefined}
                    required
                  >
                    <MoneyInput
                      currency={currency}
                      required
                      value={field.value}
                      onChange={(v) => field.onChange(v)}
                      onBlur={field.onBlur}
                    />
                  </FormField>
                )}
              />
              <Controller
                control={control}
                name="discountedPrice"
                render={({ field, fieldState }) => (
                  <FormField
                    label="Sale price"
                    error={fieldState.error?.message}
                    description="Optional. Must be lower than the price."
                  >
                    <MoneyInput
                      currency={currency}
                      value={field.value}
                      onChange={(v) => field.onChange(v)}
                      onBlur={field.onBlur}
                      placeholder="—"
                    />
                  </FormField>
                )}
              />
              <FormField
                label="Prep time (minutes)"
                description="Estimate shown to guests when enabled for the restaurant."
                error={errors.prepTimeMinutes?.message}
                required
              >
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={240}
                  {...register("prepTimeMinutes", { valueAsNumber: true })}
                />
              </FormField>
              <div className="flex flex-col justify-end gap-3 pb-1">
                <Controller
                  control={control}
                  name="isAvailable"
                  render={({ field }) => (
                    <label className="flex items-center justify-between gap-3 text-sm">
                      <span>
                        Available
                        <span className="block text-xs text-muted-foreground">
                          Off hides it at every branch.
                        </span>
                      </span>
                      <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                    </label>
                  )}
                />
                <Controller
                  control={control}
                  name="isFeatured"
                  render={({ field }) => (
                    <label className="flex items-center justify-between gap-3 text-sm">
                      <span>
                        Featured
                        <span className="block text-xs text-muted-foreground">
                          Highlighted at the top of the menu.
                        </span>
                      </span>
                      <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
                    </label>
                  )}
                />
              </div>
            </div>
            <Controller
              control={control}
              name="allergens"
              render={({ field, fieldState }) => (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 text-sm font-medium">Allergens</legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {ALLERGENS.map((a) => {
                      const checked = (field.value ?? []).includes(a);
                      return (
                        <label key={a} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(on) =>
                              field.onChange(
                                on
                                  ? [...(field.value ?? []), a]
                                  : (field.value ?? []).filter((x) => x !== a),
                              )
                            }
                          />
                          {ALLERGEN_LABELS[a]}
                        </label>
                      );
                    })}
                  </div>
                  {fieldState.error?.message && (
                    <p role="alert" className="text-sm font-medium text-destructive">
                      {fieldState.error.message}
                    </p>
                  )}
                </fieldset>
              )}
            />
          </TabsContent>

          <TabsContent value="variants">
            <VariantsFields
              control={control}
              register={register}
              errors={errors}
              currency={currency}
            />
          </TabsContent>

          <TabsContent value="addons">
            <AddonGroupsFields
              control={control}
              register={register}
              errors={errors}
              currency={currency}
            />
          </TabsContent>

          {item && canManageBranch && (
            <TabsContent value="branch">
              <BranchPricingPanel
                branchId={branchId}
                branchName={branchName}
                item={item}
                override={override}
                currency={currency}
              />
            </TabsContent>
          )}
        </Tabs>
        {tab !== "branch" && <PricePreview control={control} currency={currency} />}
      </SheetBody>
      {plan.error || formError ? (
        <div className="grid gap-2 border-t px-4 pt-3">
          <PlanErrorNotice error={plan.error} workspaceId={workspaceId} />
          <FormError>{formError}</FormError>
        </div>
      ) : null}
      <SheetFooter className="flex-row items-center border-t">
        {item && (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 aria-hidden /> Delete item
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Spinner decorative />}
            {item ? "Save item" : "Add item"}
          </Button>
        </div>
      </SheetFooter>
      {item && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete ${item.name}?`}
          description="It disappears from every branch's menu right away. Past orders and bills keep their record of it, and it stops counting towards your plan's menu item limit."
          confirmLabel="Delete item"
          destructive
          getErrorMessage={errorMessage}
          onConfirm={async () => {
            await remove.mutateAsync(item.id);
            toast.success(`${item.name} deleted`);
            onOpenChange(false);
          }}
        />
      )}
    </form>
  );
}

interface FieldsProps {
  control: Control<Values, unknown, CreateItemData>;
  register: UseFormRegister<Values>;
  errors: FieldErrors<Values>;
  currency: string;
}

function VariantsFields({ control, register, errors, currency }: FieldsProps) {
  const { fields, append, remove, move, update } = useFieldArray({
    control,
    name: "variants",
    keyName: "key",
  });
  const values = useWatch({ control, name: "variants" }) ?? [];
  const rootError = errors.variants?.message ?? errors.variants?.root?.message;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Sizes or portions, each with its own price (e.g. Half / Full). Guests must pick one.
      </p>
      {rootError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {rootError}
        </p>
      )}
      {fields.map((f, i) => {
        const e = errors.variants?.[i];
        return (
          <div
            key={f.key}
            className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_9rem_auto]"
          >
            <FormField label="Variant name" error={e?.name?.message} required>
              <Input {...register(`variants.${i}.name`)} placeholder="e.g. Full" />
            </FormField>
            <Controller
              control={control}
              name={`variants.${i}.price`}
              render={({ field, fieldState }) => (
                <FormField label="Price" error={fieldState.error?.message} required>
                  <MoneyInput
                    currency={currency}
                    required
                    value={field.value}
                    onChange={(v) => field.onChange(v)}
                    onBlur={field.onBlur}
                  />
                </FormField>
              )}
            />
            <div className="flex items-end gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${values[i]?.name || "variant"} up`}
                disabled={i === 0}
                onClick={() => move(i, i - 1)}
              >
                <ArrowUp aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Move ${values[i]?.name || "variant"} down`}
                disabled={i === fields.length - 1}
                onClick={() => move(i, i + 1)}
              >
                <ArrowDown aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${values[i]?.name || "variant"}`}
                onClick={() => remove(i)}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
            <div className="flex flex-wrap gap-4 sm:col-span-3">
              <Controller
                control={control}
                name={`variants.${i}.isDefault`}
                render={({ field }) => (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={field.value ?? false}
                      onCheckedChange={(on) => {
                        // Only one default: clear the others.
                        values.forEach((v, j) => {
                          if (j !== i && v.isDefault) update(j, { ...v, isDefault: false });
                        });
                        field.onChange(Boolean(on));
                      }}
                    />
                    Default choice
                  </label>
                )}
              />
              <Controller
                control={control}
                name={`variants.${i}.isAvailable`}
                render={({ field }) => (
                  <label className="flex items-center gap-2 text-sm">
                    <Switch checked={field.value ?? true} onCheckedChange={field.onChange} />
                    Available
                  </label>
                )}
              />
            </div>
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={fields.length >= 20}
        onClick={() =>
          append({
            name: "",
            price: Number.NaN,
            isDefault: fields.length === 0,
            isAvailable: true,
          })
        }
      >
        <Plus aria-hidden /> Add variant
      </Button>
    </div>
  );
}

function AddonGroupsFields({ control, register, errors, currency }: FieldsProps) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "addonGroups",
    keyName: "key",
  });
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Optional extras or required choices (e.g. &ldquo;Spice level&rdquo;, choose 1).
      </p>
      {fields.map((f, i) => {
        const e = errors.addonGroups?.[i];
        return (
          <div key={f.key} className="flex flex-col gap-3 rounded-lg border p-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_6rem_6rem_auto]">
              <FormField label="Group name" error={e?.name?.message} required>
                <Input {...register(`addonGroups.${i}.name`)} placeholder="e.g. Toppings" />
              </FormField>
              <FormField
                label="Min"
                description="0 = optional"
                error={e?.minSelect?.message}
                required
              >
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  {...register(`addonGroups.${i}.minSelect`, { valueAsNumber: true })}
                />
              </FormField>
              <FormField
                label="Max"
                description="Most a guest can pick"
                error={e?.maxSelect?.message}
                required
              >
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  {...register(`addonGroups.${i}.maxSelect`, { valueAsNumber: true })}
                />
              </FormField>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove group"
                  onClick={() => remove(i)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            </div>
            <AddonsFields
              control={control}
              register={register}
              errors={errors}
              currency={currency}
              groupIndex={i}
            />
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={fields.length >= 10}
        onClick={() =>
          append({
            name: "",
            minSelect: 0,
            maxSelect: 1,
            addons: [{ name: "", price: 0, isAvailable: true }],
          })
        }
      >
        <Plus aria-hidden /> Add add-on group
      </Button>
    </div>
  );
}

function AddonsFields({
  control,
  register,
  errors,
  currency,
  groupIndex,
}: FieldsProps & { groupIndex: number }) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: `addonGroups.${groupIndex}.addons`,
    keyName: "key",
  });
  const groupErrors = errors.addonGroups?.[groupIndex];
  const rootError = groupErrors?.addons?.message ?? groupErrors?.addons?.root?.message;
  return (
    <div className="flex flex-col gap-2 border-l-2 pl-3">
      <Label className="text-xs text-muted-foreground uppercase">Options</Label>
      {rootError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {rootError}
        </p>
      )}
      {fields.map((f, j) => {
        const e = groupErrors?.addons?.[j];
        return (
          <div key={f.key} className="grid grid-cols-[1fr_8rem_auto_auto] items-start gap-2">
            <FormField label="Option" hideLabel error={e?.name?.message}>
              <Input
                {...register(`addonGroups.${groupIndex}.addons.${j}.name`)}
                placeholder="Option name"
              />
            </FormField>
            <Controller
              control={control}
              name={`addonGroups.${groupIndex}.addons.${j}.price`}
              render={({ field, fieldState }) => (
                <FormField label="Option price" hideLabel error={fieldState.error?.message}>
                  <MoneyInput
                    currency={currency}
                    value={field.value ?? 0}
                    onChange={(v) => field.onChange(v ?? 0)}
                    onBlur={field.onBlur}
                  />
                </FormField>
              )}
            />
            <Controller
              control={control}
              name={`addonGroups.${groupIndex}.addons.${j}.isAvailable`}
              render={({ field }) => (
                <Switch
                  className="mt-2.5"
                  aria-label="Option available"
                  checked={field.value ?? true}
                  onCheckedChange={field.onChange}
                />
              )}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="mt-1"
              aria-label="Remove option"
              disabled={fields.length <= 1}
              onClick={() => remove(j)}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        );
      })}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start"
        disabled={fields.length >= 30}
        onClick={() => append({ name: "", price: 0, isAvailable: true })}
      >
        <Plus aria-hidden /> Add option
      </Button>
    </div>
  );
}

/** Live price preview with the same pricing engine the server uses. */
function PricePreview({
  control,
  currency,
}: {
  control: Control<Values, unknown, CreateItemData>;
  currency: string;
}) {
  const values = useWatch({ control });
  const [variantKey, setVariantKey] = useState<string | null>(null);
  const [addonKeys, setAddonKeys] = useState<string[]>([]);

  const priced = useMemo<PricedItem | null>(() => {
    const price = values.price;
    if (typeof price !== "number" || Number.isNaN(price)) return null;
    const variants = (values.variants ?? []).filter(
      (v) => v && typeof v.price === "number" && !Number.isNaN(v.price),
    );
    return {
      id: "preview",
      name: values.name || "This item",
      price,
      discountedPrice:
        typeof values.discountedPrice === "number" && !Number.isNaN(values.discountedPrice)
          ? values.discountedPrice
          : null,
      isAvailable: true,
      variants: variants.map((v, i) => ({
        id: `v${i}`,
        name: v!.name || `Variant ${i + 1}`,
        price: v!.price!,
        isAvailable: v!.isAvailable ?? true,
      })),
      addonGroups: (values.addonGroups ?? []).map((g, gi) => ({
        id: `g${gi}`,
        name: g?.name || `Group ${gi + 1}`,
        minSelect: Number.isFinite(g?.minSelect) ? g!.minSelect! : 0,
        maxSelect: Number.isFinite(g?.maxSelect) ? g!.maxSelect! : 1,
        addons: (g?.addons ?? []).map((a, ai) => ({
          id: `g${gi}a${ai}`,
          name: a?.name || `Option ${ai + 1}`,
          price: typeof a?.price === "number" && !Number.isNaN(a.price) ? a.price : 0,
          isAvailable: a?.isAvailable ?? true,
        })),
      })),
    };
  }, [values]);

  if (!priced) {
    return (
      <div className="mt-6 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        Enter a price to preview what guests pay.
      </div>
    );
  }

  const defaultIdx = (values.variants ?? []).findIndex((v) => v?.isDefault);
  const selectedVariant =
    priced.variants.find((v) => v.id === variantKey)?.id ??
    priced.variants[defaultIdx >= 0 ? defaultIdx : 0]?.id ??
    null;
  let line: ReturnType<typeof priceSelection> | null = null;
  let problems: string[] = [];
  try {
    line = priceSelection(priced, {
      variantId: selectedVariant,
      addonIds: addonKeys.filter((k) =>
        priced.addonGroups.some((g) => g.addons.some((a) => a.id === k)),
      ),
      quantity: 1,
    });
  } catch (e) {
    problems =
      e instanceof DomainError && e.fieldErrors
        ? Object.values(e.fieldErrors).flat()
        : ["Check the item setup"];
  }

  return (
    <section
      aria-label="Price preview"
      className="mt-6 flex flex-col gap-3 rounded-lg border bg-muted/40 p-4"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Guest preview</h3>
        <span className="text-sm text-muted-foreground">
          From{" "}
          <span className="font-semibold text-foreground">
            {formatMoney(startingPrice(priced), currency)}
          </span>
        </span>
      </div>
      {priced.variants.length > 0 && (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Preview variant">
          {priced.variants.map((v) => (
            <button
              key={v.id}
              type="button"
              role="radio"
              aria-checked={v.id === selectedVariant}
              onClick={() => setVariantKey(v.id)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                v.id === selectedVariant && "border-primary bg-primary/10 text-primary",
                !v.isAvailable && "line-through opacity-60",
              )}
            >
              {v.name} · {formatMoney(v.price, currency)}
            </button>
          ))}
        </div>
      )}
      {priced.addonGroups.map((g) => (
        <div key={g.id} className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{g.name}:</span>
          {g.addons.map((a) => {
            const on = addonKeys.includes(a.id);
            return (
              <button
                key={a.id}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setAddonKeys((keys) => (on ? keys.filter((k) => k !== a.id) : [...keys, a.id]))
                }
                className={cn(
                  "rounded-full border px-3 py-1 text-xs",
                  on && "border-primary bg-primary/10 text-primary",
                  !a.isAvailable && "line-through opacity-60",
                )}
              >
                {a.name}
                {a.price > 0 && ` +${formatMoney(a.price, currency)}`}
              </button>
            );
          })}
        </div>
      ))}
      {line ? (
        <p className="text-sm">
          One serving:{" "}
          <span className="font-semibold tabular-nums">
            {formatMoney(line.unitPrice, currency)}
          </span>
          {line.addonsUnitTotal > 0 && (
            <span className="text-muted-foreground">
              {" "}
              ({formatMoney(line.baseUnitPrice, currency)} +{" "}
              {formatMoney(line.addonsUnitTotal, currency)} add-ons)
            </span>
          )}
        </p>
      ) : (
        <ul className="list-disc pl-5 text-sm text-warning-foreground dark:text-warning">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
