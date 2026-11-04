"use client";

import { RefreshCwIcon, ShoppingBagIcon, WifiOffIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import type { GuestOrderViewDto } from "@/contracts/ordering";
import { formatMoney } from "@/domain/shared/money";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/feedback/empty-state";
import { ApiError, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import { cartTotals, useCartStore } from "../cart-store";
import { usePlaceOrder } from "../queries";
import { DietaryMark } from "./dietary-mark";
import { QuantityStepper } from "./quantity-stepper";

interface CartSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  currency: string;
  canOrder: boolean;
  onJoined: (sessionId: string) => void;
  onPlaced: (order: GuestOrderViewDto) => void;
  onMenuOutdated: () => void;
}

/**
 * Cart drawer and order submission. Submitting requires connectivity: when
 * offline (or the request never reaches the server) the cart is kept and the
 * guest sees an explicit "not sent" state with Retry — never a fake success.
 * One idempotency key is reused for every retry of the same cart, so a retry
 * after a lost response cannot create a duplicate order.
 */
export function CartSheet({
  open,
  onOpenChange,
  token,
  currency,
  canOrder,
  onJoined,
  onPlaced,
  onMenuOutdated,
}: CartSheetProps) {
  const ids = useId();
  const lines = useCartStore((s) => s.lines);
  const instructions = useCartStore((s) => s.specialInstructions);
  const setInstructions = useCartStore((s) => s.setInstructions);
  const setQuantity = useCartStore((s) => s.setQuantity);
  const submissionKey = useCartStore((s) => s.submissionKey);
  const clear = useCartStore((s) => s.clear);
  const place = usePlaceOrder(token, onJoined);
  const [offline, setOffline] = useState(false);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const { count, subtotal } = cartTotals(lines);

  const submit = async () => {
    setFormError(null);
    setLineErrors({});
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setOffline(true);
      return;
    }
    setOffline(false);
    const snapshot = lines;
    const idempotencyKey = submissionKey();
    try {
      const order = await place.mutateAsync({
        idempotencyKey,
        specialInstructions: instructions.trim() || undefined,
        lines: snapshot.map((l) => ({
          menuItemId: l.menuItemId,
          variantId: l.variantId,
          addonIds: l.addonIds,
          quantity: l.quantity,
          notes: l.notes.trim() || undefined,
        })),
      });
      clear();
      onPlaced(order);
    } catch (error) {
      if (error instanceof ApiError && error.isNetworkError) {
        setOffline(true);
        return;
      }
      if (error instanceof ApiError && error.code === "VALIDATION_FAILED") {
        const mapped: Record<string, string> = {};
        let general: string | null = null;
        for (const [field, messages] of Object.entries(error.fieldErrors)) {
          const m = /^lines\.(\d+)\./.exec(field);
          const line = m ? snapshot[Number(m[1])] : undefined;
          if (line && messages[0] && !mapped[line.id]) mapped[line.id] = messages[0];
          else if (messages[0]) general ??= messages[0];
        }
        setLineErrors(mapped);
        if (Object.keys(mapped).length > 0) onMenuOutdated();
        setFormError(general ?? (Object.keys(mapped).length === 0 ? error.message : null));
        return;
      }
      setFormError(errorMessage(error));
      toast.error(errorMessage(error));
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[92dvh] w-full max-w-2xl gap-0 sm:rounded-t-2xl">
        <SheetHeader className="border-b">
          <SheetTitle className="text-lg">Your order</SheetTitle>
          <SheetDescription>
            {count > 0
              ? `${count} item${count === 1 ? "" : "s"} · review and send to the kitchen`
              : "Your cart is empty"}
          </SheetDescription>
        </SheetHeader>

        {lines.length === 0 ? (
          <SheetBody className="py-6">
            <EmptyState
              icon={<ShoppingBagIcon />}
              title="Nothing here yet"
              description="Add dishes from the menu and they'll appear here."
              action={<Button onClick={() => onOpenChange(false)}>Browse the menu</Button>}
            />
          </SheetBody>
        ) : (
          <SheetBody className="space-y-4 py-4">
            <ul className="divide-y">
              {lines.map((line) => (
                <li key={line.id} className="py-3">
                  <div className="flex items-start gap-3">
                    <DietaryMark dietary={line.dietary} className="mt-1" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium leading-snug">{line.name}</p>
                      {(line.variantName || line.addonNames.length > 0) && (
                        <p className="text-sm text-muted-foreground">
                          {[line.variantName, ...line.addonNames].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      {line.notes && (
                        <p className="text-sm text-muted-foreground italic">“{line.notes}”</p>
                      )}
                      <p className="mt-1 text-sm tabular-nums">
                        {formatMoney(line.unitPrice * line.quantity, currency)}
                      </p>
                    </div>
                    <QuantityStepper
                      value={line.quantity}
                      onChange={(q) => {
                        setQuantity(line.id, q);
                        setLineErrors(({ [line.id]: _, ...rest }) => rest);
                      }}
                      label={line.name}
                      removable
                    />
                  </div>
                  {lineErrors[line.id] && (
                    <p className="mt-2 ml-6 text-sm text-destructive" role="alert">
                      {lineErrors[line.id]}
                    </p>
                  )}
                </li>
              ))}
            </ul>

            <div className="space-y-2">
              <label htmlFor={`${ids}-instructions`} className="text-sm font-semibold">
                Special instructions{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Textarea
                id={`${ids}-instructions`}
                value={instructions}
                maxLength={500}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Allergies, timing, anything the kitchen should know"
                rows={2}
              />
              <p className="text-right text-xs text-muted-foreground tabular-nums">
                {instructions.length}/500
              </p>
            </div>

            <dl className="space-y-1 rounded-lg bg-muted/60 p-3 text-sm">
              <div className="flex justify-between font-semibold">
                <dt>Subtotal (estimate)</dt>
                <dd className="tabular-nums">{formatMoney(subtotal, currency)}</dd>
              </div>
              <p className="text-xs text-muted-foreground">
                Final prices are confirmed by the restaurant. Taxes and charges are added to your
                bill.
              </p>
            </dl>
          </SheetBody>
        )}

        {lines.length > 0 && (
          <SheetFooter className="border-t bg-background">
            {offline && (
              <Alert variant="warning" role="alert">
                <WifiOffIcon />
                <AlertTitle>You&apos;re offline — your order hasn&apos;t been sent</AlertTitle>
                <AlertDescription>
                  Your cart is saved on this phone. Reconnect and tap Retry; it will only be sent
                  once.
                </AlertDescription>
              </Alert>
            )}
            {formError && !offline && (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            )}
            {!canOrder && (
              <p className="text-sm text-muted-foreground">
                Ordering from the table is paused right now. Please ask a member of staff.
              </p>
            )}
            <Button
              type="button"
              size="lg"
              className={cn("h-12 justify-between text-base sm:h-12", offline && "justify-center")}
              onClick={() => void submit()}
              disabled={place.isPending || !canOrder}
            >
              {place.isPending ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner decorative /> Sending to the restaurant…
                </span>
              ) : offline ? (
                <span className="inline-flex items-center gap-2">
                  <RefreshCwIcon className="size-4" aria-hidden /> Retry sending order
                </span>
              ) : (
                <>
                  <span>Place order</span>
                  <span className="tabular-nums">{formatMoney(subtotal, currency)}</span>
                </>
              )}
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
