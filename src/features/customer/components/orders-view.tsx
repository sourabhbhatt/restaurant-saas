"use client";

import {
  BellRingIcon,
  CheckIcon,
  ClipboardListIcon,
  PartyPopperIcon,
  PlusIcon,
  ReceiptIcon,
  XCircleIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { GuestOrderViewDto, GuestSessionDto } from "@ros/contracts/ordering";
import type { OrderStatus } from "@ros/domain/orders/order-status";
import { formatMoney } from "@ros/domain/shared/money";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/shared/feedback/confirm-dialog";
import { EmptyState } from "@/components/shared/feedback/empty-state";
import { ErrorState } from "@/components/shared/feedback/error-state";
import { errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import { useRequestBill } from "../queries";

const STEPS: { status: OrderStatus; label: string }[] = [
  { status: "PENDING", label: "Sent" },
  { status: "ACCEPTED", label: "Confirmed" },
  { status: "PREPARING", label: "Preparing" },
  { status: "READY", label: "Ready" },
  { status: "SERVED", label: "Served" },
];

const STATUS_COPY: Record<OrderStatus, { label: string; hint: string; tone: BadgeTone }> = {
  PENDING: {
    label: "Waiting for confirmation",
    hint: "The restaurant will confirm your order shortly.",
    tone: "warning",
  },
  ACCEPTED: { label: "Confirmed", hint: "Your order is with the kitchen.", tone: "info" },
  PREPARING: { label: "Preparing", hint: "The kitchen is cooking your food.", tone: "info" },
  READY: { label: "Ready", hint: "Your food is on its way to your table.", tone: "success" },
  SERVED: { label: "Served", hint: "Enjoy your meal!", tone: "success" },
  COMPLETED: { label: "Completed", hint: "Thanks for dining with us.", tone: "secondary" },
  REJECTED: { label: "Not accepted", hint: "", tone: "destructive" },
  CANCELLED: { label: "Cancelled", hint: "", tone: "destructive" },
};
type BadgeTone = "warning" | "info" | "success" | "secondary" | "destructive";

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

interface OrdersViewProps {
  token: string;
  joined: boolean;
  session: GuestSessionDto | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  onBrowse: () => void;
  onShowBill: () => void;
}

/** The guest's own orders with a live status timeline (polled by the parent query). */
export function OrdersView({
  token,
  joined,
  session,
  isPending,
  isError,
  error,
  onRetry,
  onBrowse,
  onShowBill,
}: OrdersViewProps) {
  const [confirmBill, setConfirmBill] = useState(false);
  const requestBill = useRequestBill(token);

  if (!joined) {
    return (
      <EmptyState
        className="mx-4 mt-8"
        icon={<ClipboardListIcon />}
        title="No orders yet"
        description="Orders you place from this table will appear here with live updates."
        action={<Button onClick={onBrowse}>Browse the menu</Button>}
      />
    );
  }
  if (isPending) {
    return (
      <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading your orders">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    );
  }
  if (isError || !session) {
    return (
      <div className="p-4">
        <ErrorState
          title="Couldn't load your orders"
          message={errorMessage(error)}
          onRetry={onRetry}
        />
      </div>
    );
  }

  const orders = [...session.orders].reverse();
  const status = session.session.status;

  return (
    <div className="space-y-4 p-4">
      {status === "BILL_REQUESTED" && (
        <Alert variant="info">
          <BellRingIcon />
          <AlertTitle>Bill requested</AlertTitle>
          <AlertDescription>A member of staff will bring your bill shortly.</AlertDescription>
        </Alert>
      )}
      {status === "BILLED" && (
        <Alert variant="success">
          <ReceiptIcon />
          <AlertTitle>Your bill is ready</AlertTitle>
          <AlertDescription>
            <Button variant="link" className="h-auto p-0" onClick={onShowBill}>
              View the bill
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {status === "CLOSED" && (
        <Alert>
          <PartyPopperIcon />
          <AlertTitle>Thanks for visiting!</AlertTitle>
          <AlertDescription>This table session has ended.</AlertDescription>
        </Alert>
      )}

      {orders.length === 0 ? (
        <EmptyState
          icon={<ClipboardListIcon />}
          title="No orders yet"
          description="Orders you place from this phone will appear here."
          action={
            session.canOrder ? <Button onClick={onBrowse}>Browse the menu</Button> : undefined
          }
        />
      ) : (
        <ol className="space-y-4" aria-label="Your orders">
          {orders.map((o) => (
            <li key={o.id}>
              <OrderCard order={o} />
            </li>
          ))}
        </ol>
      )}

      {(session.canOrder || session.canRequestBill) && (
        <div className="flex flex-col gap-2 pt-2 sm:flex-row">
          {session.canOrder && (
            <Button size="lg" className="h-12 sm:flex-1" onClick={onBrowse}>
              <PlusIcon /> Add more items
            </Button>
          )}
          {session.canRequestBill && (
            <Button
              size="lg"
              variant="outline"
              className="h-12 sm:flex-1"
              onClick={() => setConfirmBill(true)}
            >
              <ReceiptIcon /> Request the bill
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmBill}
        onOpenChange={setConfirmBill}
        title="Ask for the bill?"
        description="We'll let the staff know your table is ready for the bill. You can still order more afterwards."
        confirmLabel="Request bill"
        pendingLabel="Requesting…"
        getErrorMessage={errorMessage}
        onConfirm={async () => {
          await requestBill.mutateAsync();
          toast.success("Bill requested — staff have been notified");
        }}
      />
    </div>
  );
}

function OrderCard({ order }: { order: GuestOrderViewDto }) {
  const copy = STATUS_COPY[order.status];
  const reached = new Map(order.timeline.map((s) => [s.status, s.at]));
  const terminalBad = order.status === "REJECTED" || order.status === "CANCELLED";
  const currentIndex = STEPS.findIndex((s) => s.status === order.status);
  const doneIndex = order.status === "COMPLETED" ? STEPS.length - 1 : currentIndex;

  return (
    <article
      className="rounded-xl border bg-card p-4 shadow-xs"
      aria-label={`Order ${order.orderNumber}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Order #{order.orderNumber}</h3>
          <p className="text-xs text-muted-foreground">Placed at {time(order.createdAt)}</p>
        </div>
        <Badge variant={copy.tone}>{copy.label}</Badge>
      </header>

      {terminalBad ? (
        <Alert variant="destructive" className="mt-3">
          <XCircleIcon />
          <AlertTitle>
            {order.status === "REJECTED"
              ? "The restaurant couldn't accept this order"
              : "This order was cancelled"}
          </AlertTitle>
          <AlertDescription>
            {order.rejectionReason ?? "Please ask a member of staff if you have questions."}
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <ol className="mt-4 grid grid-cols-5 gap-1" aria-label="Order progress">
            {STEPS.map((step, i) => {
              const done = i <= doneIndex;
              const at = reached.get(step.status);
              return (
                <li key={step.status} className="flex flex-col items-center gap-1 text-center">
                  <span className="flex w-full items-center">
                    <span
                      className={cn(
                        "h-0.5 flex-1",
                        i === 0 ? "bg-transparent" : done ? "bg-primary" : "bg-border",
                      )}
                    />
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px]",
                        done
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background",
                        i === currentIndex && "motion-safe:animate-pulse",
                      )}
                      aria-hidden
                    >
                      {done && <CheckIcon className="size-3.5" />}
                    </span>
                    <span
                      className={cn(
                        "h-0.5 flex-1",
                        i === STEPS.length - 1
                          ? "bg-transparent"
                          : i < doneIndex
                            ? "bg-primary"
                            : "bg-border",
                      )}
                    />
                  </span>
                  <span
                    className={cn(
                      "text-[11px] leading-tight",
                      done ? "font-medium text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {step.label}
                    <span className="sr-only">{done ? " (done)" : " (upcoming)"}</span>
                  </span>
                  {at && <span className="text-[10px] text-muted-foreground">{time(at)}</span>}
                </li>
              );
            })}
          </ol>
          {copy.hint && (
            <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
              {copy.hint}
            </p>
          )}
        </>
      )}

      <ul className="mt-3 space-y-1.5 border-t pt-3 text-sm">
        {order.items.map((item, i) => (
          <li key={i} className="flex justify-between gap-3">
            <span className="min-w-0">
              <span className="font-medium tabular-nums">{item.quantity}×</span> {item.itemName}
              {(item.variantName || item.addons.length > 0) && (
                <span className="block text-xs text-muted-foreground">
                  {[item.variantName, ...item.addons.map((a) => a.name)]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
              {item.notes && (
                <span className="block text-xs text-muted-foreground italic">“{item.notes}”</span>
              )}
            </span>
            <span className="shrink-0 tabular-nums">
              {formatMoney(item.lineTotal, order.currency)}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex justify-between border-t pt-2 text-sm font-semibold">
        <span>Subtotal</span>
        <span className="tabular-nums">{formatMoney(order.subtotal, order.currency)}</span>
      </p>
    </article>
  );
}
