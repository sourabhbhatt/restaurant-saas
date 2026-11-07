"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Minus, Plus, ShoppingBasket, Trash2, UtensilsCrossed } from "lucide-react";
import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { EmptyState, ErrorState, LoadingState } from "@ros/ui/shared/feedback";
import { Button } from "@ros/ui/ui/button";
import { Checkbox } from "@ros/ui/ui/checkbox";
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
import { SearchInput } from "@ros/ui/ui/search-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ros/ui/ui/select";
import { Spinner } from "@ros/ui/ui/spinner";
import { Textarea } from "@ros/ui/ui/textarea";
import type { BranchMenuItem } from "@ros/contracts/menu";
import { staffPlaceOrderSchema } from "@ros/contracts/orders";
import { ORDER_PRIORITIES } from "@ros/domain/orders/order-status";
import { effectiveItemPrice, priceSelection } from "@ros/domain/menu/pricing";
import { DomainError } from "@ros/domain/shared/errors";
import { formatMoney } from "@ros/domain/shared/money";
import { ApiError, applyFieldErrors, errorMessage, newIdempotencyKey } from "@ros/api-client";
import { cn } from "@ros/ui/utils";
import {
  enqueueMutation,
  scopeHasUnsynced,
  staffOrderMutation,
  tableScope,
  useSyncStore,
} from "@ros/web-core/features/offline";

import { useBranchMenu, useStaffOrder } from "./queries";

type FormIn = z.input<typeof staffPlaceOrderSchema>;
type FormOut = z.output<typeof staffPlaceOrderSchema>;

interface CartLine {
  key: string;
  item: BranchMenuItem;
  variantId: string | null;
  addonIds: string[];
  quantity: number;
  notes?: string;
}

function linePrice(line: CartLine): { unit: number; label: string | null; error: string | null } {
  try {
    const priced = priceSelection(line.item, {
      variantId: line.variantId,
      addonIds: line.addonIds,
      quantity: line.quantity,
    });
    const extras = [priced.variantName, ...priced.addons.map((a) => a.name)].filter(Boolean);
    return { unit: priced.unitPrice, label: extras.join(", ") || null, error: null };
  } catch (error) {
    const msg =
      error instanceof DomainError
        ? (Object.values(error.fieldErrors ?? {})[0]?.[0] ?? error.message)
        : "Invalid selection";
    return { unit: 0, label: null, error: msg };
  }
}

function startingPrice(item: BranchMenuItem): number {
  const available = item.variants.filter((v) => v.isAvailable);
  if (available.length) return Math.min(...available.map((v) => v.price));
  return effectiveItemPrice(item);
}

/** Configure one item: variant, add-ons (min/max per group), quantity and note. */
function ItemConfigurator({
  item,
  currency,
  onAdd,
  onCancel,
}: {
  item: BranchMenuItem;
  currency: string;
  onAdd: (line: Omit<CartLine, "key">) => void;
  onCancel: () => void;
}) {
  const [variantId, setVariantId] = useState<string | null>(
    item.variants.find((v) => v.isAvailable)?.id ?? null,
  );
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const draft: CartLine = { key: "draft", item, variantId, addonIds, quantity, notes };
  const price = linePrice(draft);

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-muted/30 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">{item.name}</p>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Back to menu
        </Button>
      </div>
      {item.variants.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Choose one</legend>
          <div className="flex flex-wrap gap-2">
            {item.variants.map((v) => (
              <button
                key={v.id}
                type="button"
                disabled={!v.isAvailable}
                aria-pressed={variantId === v.id}
                onClick={() => setVariantId(v.id)}
                className={cn(
                  "min-h-10 rounded-lg border px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50",
                  variantId === v.id && "border-primary bg-primary/10 text-primary",
                )}
              >
                {v.name} · {formatMoney(v.price, currency)}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {item.addonGroups.map((g) => {
        const chosen = addonIds.filter((id) => g.addons.some((a) => a.id === id));
        return (
          <fieldset key={g.id} className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">
              {g.name}{" "}
              <span className="font-normal text-muted-foreground">
                ({g.minSelect > 0 ? `pick ${g.minSelect}–${g.maxSelect}` : `up to ${g.maxSelect}`})
              </span>
            </legend>
            {g.addons.map((a) => {
              const checked = addonIds.includes(a.id);
              const full = !checked && chosen.length >= g.maxSelect;
              return (
                <label
                  key={a.id}
                  className={cn(
                    "flex min-h-10 items-center gap-3 rounded-lg border px-3 text-sm",
                    (!a.isAvailable || full) && "opacity-50",
                  )}
                >
                  <Checkbox
                    checked={checked}
                    disabled={!a.isAvailable || full}
                    onCheckedChange={(v) =>
                      setAddonIds((ids) => (v ? [...ids, a.id] : ids.filter((x) => x !== a.id)))
                    }
                  />
                  <span className="flex-1">{a.name}</span>
                  {a.price > 0 && (
                    <span className="text-muted-foreground">+{formatMoney(a.price, currency)}</span>
                  )}
                </label>
              );
            })}
          </fieldset>
        );
      })}
      <FormField label="Note for the kitchen" description="Optional, e.g. less spicy">
        <Input value={notes} maxLength={200} onChange={(e) => setNotes(e.target.value)} />
      </FormField>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <QuantityStepper value={quantity} onChange={setQuantity} label={item.name} />
        <Button
          type="button"
          disabled={Boolean(price.error)}
          onClick={() =>
            onAdd({ item, variantId, addonIds, quantity, notes: notes.trim() || undefined })
          }
        >
          <Plus aria-hidden /> Add · {formatMoney(price.unit * quantity, currency)}
        </Button>
      </div>
      {price.error && <p className="text-sm text-destructive">{price.error}</p>}
    </div>
  );
}

function QuantityStepper({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label={`Quantity of ${label}`}>
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        aria-label="Decrease"
        disabled={value <= 1}
        onClick={() => onChange(Math.max(1, value - 1))}
      >
        <Minus aria-hidden />
      </Button>
      <span className="w-8 text-center font-semibold tabular-nums" aria-live="polite">
        {value}
      </span>
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        aria-label="Increase"
        disabled={value >= 99}
        onClick={() => onChange(Math.min(99, value + 1))}
      >
        <Plus aria-hidden />
      </Button>
    </div>
  );
}

/**
 * Staff order for a table (orders.create). Prices shown here are a preview;
 * the server reprices every line. One idempotency key per draft makes retries
 * safe: offline (or after a network error) the draft is queued with that key
 * and shown as "Not sent" until the server answers 2xx.
 */
export function AddItemsDialog({
  branchId,
  tableId,
  tableName,
  currency,
  open,
  onOpenChange,
}: {
  branchId: string;
  tableId: string;
  tableName: string;
  currency: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const menu = useBranchMenu(branchId, open);
  const mutation = useStaffOrder(branchId);
  const online = useSyncStore((s) => s.online);
  const outbox = useSyncStore((s) => s.items);
  const [queueing, setQueueing] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [configuring, setConfiguring] = useState<BranchMenuItem | null>(null);
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(staffPlaceOrderSchema),
    defaultValues: {
      tableId,
      priority: "NORMAL",
      lines: [],
      specialInstructions: "",
      idempotencyKey: newIdempotencyKey(),
    },
  });

  const syncLines = (next: CartLine[]) => {
    setCart(next);
    form.setValue(
      "lines",
      next.map((l) => ({
        menuItemId: l.item.id,
        variantId: l.variantId,
        addonIds: l.addonIds,
        quantity: l.quantity,
        notes: l.notes,
      })),
      { shouldValidate: form.formState.isSubmitted },
    );
  };

  const addLine = (line: Omit<CartLine, "key">) => {
    const same = cart.find(
      (l) =>
        l.item.id === line.item.id &&
        l.variantId === line.variantId &&
        l.addonIds.join() === line.addonIds.join() &&
        (l.notes ?? "") === (line.notes ?? ""),
    );
    if (same) {
      syncLines(
        cart.map((l) =>
          l === same ? { ...l, quantity: Math.min(99, l.quantity + line.quantity) } : l,
        ),
      );
    } else {
      syncLines([...cart, { ...line, key: crypto.randomUUID() }]);
    }
    setConfiguring(null);
  };

  const pick = (item: BranchMenuItem) => {
    if (item.variants.length > 0 || item.addonGroups.length > 0) setConfiguring(item);
    else addLine({ item, variantId: null, addonIds: [], quantity: 1 });
  };

  const reset = () => {
    setCart([]);
    setSearch("");
    setConfiguring(null);
    form.reset({
      tableId,
      priority: "NORMAL",
      lines: [],
      specialInstructions: "",
      idempotencyKey: newIdempotencyKey(),
    });
  };

  const categories = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (menu.data?.categories ?? [])
      .map((c) => ({
        ...c,
        items: c.items.filter((i) => !q || i.name.toLowerCase().includes(q)),
      }))
      .filter((c) => c.items.length > 0);
  }, [menu.data, search]);

  const total = cart.reduce((s, l) => s + linePrice(l).unit * l.quantity, 0);
  const menuMissing = menu.error instanceof ApiError && [403, 404].includes(menu.error.status);

  /** Save the draft (same idempotency key) to the outbox; never shown as sent. */
  const queueDraft = async (body: FormOut) => {
    setQueueing(true);
    try {
      await enqueueMutation(
        staffOrderMutation({
          branchId,
          tableName,
          body,
          summary: cart.map((l) => `${l.quantity}× ${l.item.name}`).join(", "),
        }),
      );
      toast.warning("Not sent — will send when online", {
        description: `The order for ${tableName} is saved on this device.`,
      });
      reset();
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setQueueing(false);
    }
  };

  const submit = form.handleSubmit(async (values) => {
    const body = { ...values, specialInstructions: values.specialInstructions || undefined };
    // Earlier unsent orders of this table go first, so this one queues behind them.
    if (!online || scopeHasUnsynced(outbox, tableScope(tableId))) {
      await queueDraft(body);
      return;
    }
    try {
      const order = await mutation.mutateAsync(body);
      toast.success(`Order #${order.orderNumber} sent for ${tableName}`);
      reset();
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiError && error.isNetworkError) {
        // The server may or may not have it: the same key makes the resend safe.
        await queueDraft(body);
        return;
      }
      if (!applyFieldErrors(error, form.setError, ["specialInstructions", "lines", "priority"])) {
        toast.error(errorMessage(error));
      }
    }
  });
  const sending = mutation.isPending || queueing;
  const menuPaused = menu.isPending && menu.fetchStatus === "paused";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (sending) return;
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add items · {tableName}</DialogTitle>
          <DialogDescription>
            Pick dishes from the branch menu and send them as one order.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={submit}
          noValidate
          className="grid min-h-0 flex-1 gap-4 md:grid-cols-[1fr_18rem]"
        >
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
            {configuring ? (
              <ItemConfigurator
                item={configuring}
                currency={currency}
                onAdd={addLine}
                onCancel={() => setConfiguring(null)}
              />
            ) : menuPaused ? (
              <EmptyState
                size="compact"
                icon={<UtensilsCrossed />}
                title="Menu not saved on this device"
                description="Connect once to load the menu. After that, orders can be taken offline."
              />
            ) : menu.isPending ? (
              <LoadingState label="Loading menu…" />
            ) : menuMissing ? (
              <EmptyState
                size="compact"
                icon={<UtensilsCrossed />}
                title="Menu not available"
                description="This branch has no menu yet, or it is still being set up."
              />
            ) : menu.isError ? (
              <ErrorState
                size="compact"
                message={errorMessage(menu.error)}
                onRetry={() => void menu.refetch()}
              />
            ) : (
              <>
                <SearchInput
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Search dishes"
                  aria-label="Search dishes"
                />
                {categories.length === 0 ? (
                  <EmptyState
                    size="compact"
                    title="No dishes found"
                    description="Try another search."
                  />
                ) : (
                  categories.map((c) => (
                    <section
                      key={c.id}
                      aria-labelledby={`cat-${c.id}`}
                      className="flex flex-col gap-2"
                    >
                      <h3
                        id={`cat-${c.id}`}
                        className="text-sm font-semibold text-muted-foreground"
                      >
                        {c.name}
                      </h3>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {c.items.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            disabled={!item.isAvailable}
                            onClick={() => pick(item)}
                            className="flex min-h-14 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{item.name}</span>
                              {!item.isAvailable && (
                                <span className="text-xs text-muted-foreground">Unavailable</span>
                              )}
                            </span>
                            <span className="shrink-0 text-muted-foreground tabular-nums">
                              {item.variants.length ? "from " : ""}
                              {formatMoney(startingPrice(item), currency)}
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  ))
                )}
              </>
            )}
          </div>

          <aside
            className="flex min-h-0 flex-col gap-3 rounded-xl border p-3"
            aria-label="Order summary"
          >
            <p className="flex items-center gap-2 text-sm font-semibold">
              <ShoppingBasket className="size-4" aria-hidden /> This order
            </p>
            {cart.length === 0 ? (
              <p className="text-sm text-muted-foreground">No items yet.</p>
            ) : (
              <ul className="flex max-h-56 flex-col gap-2 overflow-y-auto">
                {cart.map((l) => {
                  const p = linePrice(l);
                  return (
                    <li
                      key={l.key}
                      className="flex flex-col gap-1 rounded-lg bg-muted/40 p-2 text-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium">{l.item.name}</span>
                        <span className="tabular-nums">
                          {formatMoney(p.unit * l.quantity, currency)}
                        </span>
                      </div>
                      {(p.label || l.notes) && (
                        <span className="text-xs text-muted-foreground">
                          {[p.label, l.notes].filter(Boolean).join(" · ")}
                        </span>
                      )}
                      <div className="flex items-center justify-between">
                        <QuantityStepper
                          value={l.quantity}
                          label={l.item.name}
                          onChange={(q) =>
                            syncLines(
                              cart.map((x) => (x.key === l.key ? { ...x, quantity: q } : x)),
                            )
                          }
                        />
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Remove ${l.item.name}`}
                          onClick={() => syncLines(cart.filter((x) => x.key !== l.key))}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {form.formState.errors.lines && (
              <p className="text-sm text-destructive" role="alert">
                {form.formState.errors.lines.message ?? "Check the items in this order"}
              </p>
            )}
            <FormField
              label="Instructions"
              error={form.formState.errors.specialInstructions?.message}
            >
              <Textarea
                rows={2}
                maxLength={500}
                placeholder="Optional"
                {...form.register("specialInstructions")}
              />
            </FormField>
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
                        {ORDER_PRIORITIES.map((p) => (
                          <SelectItem key={p} value={p}>
                            {p.charAt(0) + p.slice(1).toLowerCase()}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
              )}
            />
            <div className="mt-auto flex items-center justify-between border-t pt-3 font-semibold">
              <span>Estimated total</span>
              <span className="tabular-nums">{formatMoney(total, currency)}</span>
            </div>
          </aside>
          <DialogFooter className="md:col-span-2">
            <Button
              type="button"
              variant="outline"
              disabled={sending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={sending || cart.length === 0}>
              {sending && <Spinner decorative />}
              {online ? "Send order" : "Save order — send when online"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
