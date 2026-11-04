"use client";

import { Ban, Check, ChefHat, CircleCheckBig, HandPlatter, X } from "lucide-react";
import { useState } from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { OrderDto, OrderTransitionInput } from "@/contracts/orders";
import { canTransition, ORDER_TRANSITIONS } from "@/domain/orders/order-status";
import { cn } from "@/lib/utils";

import { useOrderAction } from "./queries";
import { ReasonDialog } from "./reject-dialog";

type Action = OrderTransitionInput["action"];

const ACTION_UI: Record<
  Action,
  { label: string; icon: typeof Check; variant: ButtonProps["variant"] }
> = {
  accept: { label: "Accept", icon: Check, variant: "success" },
  reject: { label: "Reject", icon: X, variant: "outline" },
  start: { label: "Start", icon: ChefHat, variant: "default" },
  ready: { label: "Mark ready", icon: CircleCheckBig, variant: "success" },
  serve: { label: "Serve", icon: HandPlatter, variant: "default" },
  cancel: { label: "Cancel order", icon: Ban, variant: "ghost" },
};

/** Actions the user may take on this order right now (UI hint; the server re-checks). */
export function availableActions(
  order: Pick<OrderDto, "status">,
  can: (permission: string) => boolean,
  only?: readonly Action[],
): Action[] {
  return (Object.keys(ACTION_UI) as Action[]).filter((a) => {
    if (only && !only.includes(a)) return false;
    const permission = ORDER_TRANSITIONS[a].permission;
    return Boolean(permission && can(permission) && canTransition(order.status, a));
  });
}

/**
 * Buttons for the allowed transitions of one order. Reject and cancel ask for
 * a reason first. Buttons are disabled while any action on this order runs
 * and the UI waits for the server (no optimistic updates).
 */
export function OrderActionButtons({
  branchId,
  order,
  can,
  only,
  size = "default",
  className,
  fill = false,
}: {
  branchId: string;
  order: OrderDto;
  can: (permission: string) => boolean;
  only?: readonly Action[];
  size?: ButtonProps["size"];
  className?: string;
  /** Stretch buttons to fill the row (touch layouts). */
  fill?: boolean;
}) {
  const mutation = useOrderAction(branchId);
  const [reasonFor, setReasonFor] = useState<"reject" | "cancel" | null>(null);
  const actions = availableActions(order, can, only);
  if (actions.length === 0) return null;

  const run = (action: Action, reason?: string) =>
    mutation.mutate({ order, action, reason }, { onSettled: () => setReasonFor(null) });

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {actions.map((action) => {
        const ui = ACTION_UI[action];
        const Icon = ui.icon;
        const busy = mutation.isPending && mutation.variables?.action === action;
        return (
          <Button
            key={action}
            type="button"
            size={size}
            variant={ui.variant}
            disabled={mutation.isPending}
            className={cn(fill && "flex-1")}
            onClick={() =>
              action === "reject" || action === "cancel" ? setReasonFor(action) : run(action)
            }
          >
            {busy ? <Spinner decorative /> : <Icon aria-hidden />}
            {ui.label}
          </Button>
        );
      })}
      <ReasonDialog
        open={reasonFor !== null}
        onOpenChange={(o) => !o && setReasonFor(null)}
        title={
          reasonFor === "cancel"
            ? `Cancel order #${order.orderNumber}?`
            : `Reject order #${order.orderNumber}?`
        }
        description={
          reasonFor === "cancel"
            ? "The kitchen will stop preparing it. The reason is kept in the order history."
            : "The guest will see that the order was declined, with this reason."
        }
        confirmLabel={reasonFor === "cancel" ? "Cancel order" : "Reject order"}
        presets={
          reasonFor === "cancel"
            ? ["Guest changed mind", "Guest left", "Item ran out", "Entered by mistake"]
            : undefined
        }
        pending={mutation.isPending}
        onSubmit={(reason) => reasonFor && run(reasonFor, reason)}
      />
    </div>
  );
}
