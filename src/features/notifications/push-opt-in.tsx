"use client";

import { BellRingIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api, errorMessage } from "@/lib/api-client";

import { usePushConfig } from "./queries";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Browser push opt-in. Renders nothing unless the server has a push
 * provider configured (`/push/config` enabled) and the browser supports it —
 * the default noop provider means no button at all.
 */
export function PushOptIn({ className }: { className?: string }) {
  const config = usePushConfig();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  if (!config.data?.enabled || !config.data.publicKey || !pushSupported()) return null;
  if (done || Notification.permission === "denied") return null;
  const publicKey = config.data.publicKey;

  const enable = async () => {
    setPending(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error("Notifications are blocked for this site in your browser settings.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));
      const json = subscription.toJSON();
      await api.post("/push/subscriptions", {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      });
      setDone(true);
      toast.success("Browser notifications enabled on this device");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className={className}
      onClick={() => void enable()}
      disabled={pending}
    >
      {pending ? <Spinner decorative /> : <BellRingIcon aria-hidden="true" />}
      Enable browser notifications
    </Button>
  );
}
