"use client";

import { CreditCard } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button, type ButtonProps } from "@ros/ui/ui/button";
import { Spinner } from "@ros/ui/ui/spinner";
import type { CheckoutSessionDto } from "@ros/contracts/payments";
import type { BillingCycle } from "@ros/domain/subscriptions/entitlements";
import { useSyncStore } from "../offline/sync-store";
import { applyFieldErrors, errorMessage } from "@ros/api-client";

import { useCreateCheckout, useVerifyCheckout } from "./queries";

const CHECKOUT_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

interface RazorpayHandlerResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  prefill?: { name?: string; email?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  handler: (response: RazorpayHandlerResponse) => void;
  modal?: { ondismiss?: () => void };
}

interface RazorpayInstance {
  open(): void;
  on(
    event: "payment.failed",
    handler: (response: { error?: { description?: string } }) => void,
  ): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

let loader: Promise<void> | null = null;

/** Loads checkout.js once, on first use; never at page load. */
function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  loader ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CHECKOUT_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loader = null;
      script.remove();
      reject(new Error("Could not load the payment form. Check your connection and try again."));
    };
    document.head.appendChild(script);
  });
  return loader;
}

/** Opens Checkout and resolves with the handler response, or null when the customer closed it. */
function openCheckout(
  session: CheckoutSessionDto,
  customer: { name?: string; email?: string },
): Promise<RazorpayHandlerResponse | null> {
  return new Promise((resolve, reject) => {
    const Razorpay = window.Razorpay;
    if (!Razorpay) {
      reject(new Error("The payment form is unavailable. Please try again."));
      return;
    }
    let settled = false;
    const done = (value: RazorpayHandlerResponse | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const checkout = new Razorpay({
      key: session.keyId,
      order_id: session.orderId,
      amount: session.amountMinor,
      currency: session.currency,
      name: session.organizationName,
      description: `${session.planName} plan, ${session.billingCycle === "ANNUAL" ? "1 year" : "1 month"}`,
      prefill: customer,
      notes: { paymentOrderId: session.paymentOrderId },
      handler: (response) => done(response),
      modal: { ondismiss: () => done(null) },
    });
    checkout.on("payment.failed", (response) => {
      toast.error(response.error?.description ?? "The payment did not go through.");
    });
    checkout.open();
  });
}

export interface PayWithRazorpayProps extends Omit<ButtonProps, "onClick" | "type"> {
  organizationId: string | null;
  workspaceId: string;
  planKey: string;
  billingCycle: BillingCycle;
  customer?: { name?: string; email?: string };
  /** Called only after the server confirmed the subscription is ACTIVE. */
  onPaid?: () => void;
  /** For react-hook-form: surfaces the server's plan errors on the form. */
  setFieldError?: Parameters<typeof applyFieldErrors>[1];
}

/**
 * "Pay with Razorpay": creates the order, opens Checkout on demand and asks
 * the server to verify the callback. Success is shown only once the verify
 * endpoint returns ACTIVE; nothing is queued offline.
 */
export function PayWithRazorpayButton({
  organizationId,
  workspaceId,
  planKey,
  billingCycle,
  customer = {},
  onPaid,
  setFieldError,
  disabled,
  children = "Pay with Razorpay",
  ...props
}: PayWithRazorpayProps) {
  const online = useSyncStore((s) => s.online);
  const create = useCreateCheckout(organizationId);
  const verify = useVerifyCheckout(organizationId, workspaceId);
  const [busy, setBusy] = useState<"idle" | "opening" | "verifying">("idle");

  async function pay() {
    if (!organizationId || !navigator.onLine) {
      toast.error("You're offline. Connect to the internet to pay.");
      return;
    }
    setBusy("opening");
    try {
      const [session] = await Promise.all([
        create.mutateAsync({ planKey, billingCycle }),
        loadCheckout(),
      ]);
      const response = await openCheckout(session, customer);
      if (!response) return;
      setBusy("verifying");
      const result = await verify.mutateAsync({
        razorpayOrderId: response.razorpay_order_id,
        razorpayPaymentId: response.razorpay_payment_id,
        razorpaySignature: response.razorpay_signature,
      });
      if (result.status === "ACTIVE") {
        toast.success(`${session.planName} plan activated. Thank you!`);
        onPaid?.();
      } else {
        toast.info(
          "Payment received; we're confirming it with Razorpay. Your plan activates automatically in a moment.",
        );
      }
    } catch (error) {
      if (setFieldError && applyFieldErrors(error, setFieldError, ["planKey", "billingCycle"]))
        return;
      toast.error(
        error instanceof Error && !("code" in error) ? error.message : errorMessage(error),
      );
    } finally {
      setBusy("idle");
    }
  }

  const offline = !online;
  return (
    <Button
      type="button"
      {...props}
      disabled={disabled || offline || !organizationId || busy !== "idle"}
      title={offline ? "Connect to the internet to pay" : undefined}
      onClick={() => void pay()}
    >
      {busy !== "idle" ? <Spinner decorative /> : <CreditCard aria-hidden />}
      {busy === "verifying" ? "Confirming payment…" : busy === "opening" ? "Opening…" : children}
    </Button>
  );
}
