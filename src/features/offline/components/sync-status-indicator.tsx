"use client";

import { useState, type ReactNode } from "react";
import {
  CloudCheckIcon,
  CloudOffIcon,
  CloudUploadIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog, EmptyState } from "@/components/shared/feedback";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import type { OutboxItem, OutboxStatus } from "../db";
import { absoluteTime, relativeTime } from "../format-time";
import {
  clearSyncedHistory,
  discardOtherAccountsChanges,
  discardOutboxItem,
  retryOutboxItem,
  retryOutboxItemWithLatest,
  syncNow,
} from "../runtime";
import { attentionCount, useSyncStore, waitingCount } from "../sync-store";

const STATUS_BADGE: Record<
  OutboxStatus,
  { label: string; variant: "secondary" | "info" | "success" | "destructive" | "warning" }
> = {
  pending: { label: "Waiting", variant: "secondary" },
  syncing: { label: "Sending", variant: "info" },
  synced: { label: "Synced", variant: "success" },
  failed: { label: "Not saved", variant: "destructive" },
  conflict: { label: "Conflict", variant: "warning" },
};

function PillContent() {
  const { online, syncing, counts } = useSyncStore();
  const waiting = waitingCount(counts);
  const attention = attentionCount(counts);

  if (attention > 0) {
    return (
      <>
        <TriangleAlertIcon aria-hidden="true" className="text-destructive" />
        <span className="text-destructive">{attention} need attention</span>
      </>
    );
  }
  if (!online) {
    return (
      <>
        <CloudOffIcon aria-hidden="true" className="text-warning-foreground dark:text-warning" />
        <span>Offline{waiting > 0 ? ` · ${waiting} waiting` : ""}</span>
      </>
    );
  }
  if (syncing && waiting > 0) {
    return (
      <>
        <Spinner decorative />
        <span>Syncing {waiting}…</span>
      </>
    );
  }
  if (waiting > 0) {
    return (
      <>
        <CloudUploadIcon aria-hidden="true" />
        <span>{waiting} waiting to sync</span>
      </>
    );
  }
  return (
    <>
      <CloudCheckIcon aria-hidden="true" className="text-success" />
      <span>Online</span>
    </>
  );
}

function statusSummary(online: boolean, waiting: number, attention: number): string {
  const parts = [online ? "Online" : "Offline"];
  if (waiting > 0) parts.push(`${waiting} waiting to sync`);
  if (attention > 0) parts.push(`${attention} need attention`);
  return parts.join(", ");
}

/**
 * Compact connection + outbox status pill for app shells. Opens a sheet that
 * lists every queued change with Sync now / Retry / Discard actions.
 */
export function SyncStatusIndicator({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const { online, counts } = useSyncStore();
  const waiting = waitingCount(counts);
  const attention = attentionCount(counts);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "rounded-full",
            attention > 0 && "border-destructive/40",
            !online && attention === 0 && "border-warning/60 bg-warning/10",
            className,
          )}
          aria-label={`Sync status: ${statusSummary(online, waiting, attention)}. Show details`}
        >
          <PillContent />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[min(100%-1.5rem,28rem)]">
        <SyncPanel />
      </SheetContent>
    </Sheet>
  );
}

function SyncPanel() {
  const { online, syncing, counts, items, otherUserPending, lastSyncAt, lastOnlineAt, authRequired, userId } =
    useSyncStore();
  const [syncPending, setSyncPending] = useState(false);
  const [confirmOther, setConfirmOther] = useState(false);

  const attention = items.filter((i) => i.status === "failed" || i.status === "conflict");
  const waiting = items.filter((i) => i.status === "pending" || i.status === "syncing");
  const synced = items.filter((i) => i.status === "synced").reverse();

  const runSync = async () => {
    setSyncPending(true);
    try {
      await syncNow();
      const state = useSyncStore.getState();
      if (!state.online) toast.error("Still offline. Your changes are safe on this device.");
      else if (waitingCount(state.counts) === 0 && attentionCount(state.counts) === 0)
        toast.success("Everything is synced");
    } finally {
      setSyncPending(false);
    }
  };

  return (
    <>
      <SheetHeader>
        <SheetTitle>Sync status</SheetTitle>
        <SheetDescription>
          {online ? "Connected." : "No connection."}{" "}
          {lastSyncAt
            ? `Last synced ${relativeTime(lastSyncAt)}.`
            : !online && lastOnlineAt
              ? `Last online ${relativeTime(lastOnlineAt)}.`
              : null}{" "}
          Changes on this list are stored only on this device until they reach the server.
        </SheetDescription>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => void runSync()}
            disabled={!userId || syncPending || syncing}
          >
            {syncPending || syncing ? <Spinner decorative /> : <RefreshCwIcon aria-hidden="true" />}
            Sync now
          </Button>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {waitingCount(counts)} waiting · {attentionCount(counts)} need attention
          </span>
        </div>
      </SheetHeader>
      <SheetBody className="flex flex-col gap-6 pb-6">
        {authRequired && (
          <Alert variant="warning">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>Sign in to continue syncing</AlertTitle>
            <AlertDescription>
              Your session ended. Waiting changes are kept and will be sent after you sign in
              again.
            </AlertDescription>
          </Alert>
        )}

        {!online && (
          <Alert variant="info">
            <CloudOffIcon aria-hidden="true" />
            <AlertTitle>Working offline</AlertTitle>
            <AlertDescription>
              Menu availability, menu edits and settings drafts are saved here and sent
              automatically when you reconnect. New orders, accepting orders and payments need a
              connection.
            </AlertDescription>
          </Alert>
        )}

        {items.length === 0 && otherUserPending === 0 && (
          <EmptyState
            size="compact"
            icon={<CloudCheckIcon />}
            title="Nothing waiting to sync"
            description="Changes you make without a connection appear here until they reach the server."
          />
        )}

        {attention.length > 0 && (
          <ItemSection title="Needs your attention" items={attention} />
        )}
        {waiting.length > 0 && <ItemSection title="Waiting to sync" items={waiting} />}
        {synced.length > 0 && (
          <ItemSection
            title="Recently synced"
            items={synced}
            action={
              <Button
                variant="ghost"
                size="xs"
                onClick={() =>
                  void clearSyncedHistory().then(() => toast.success("History cleared"))
                }
              >
                Clear
              </Button>
            }
          />
        )}

        {otherUserPending > 0 && (
          <section className="flex flex-col gap-2 rounded-lg border border-dashed p-3 text-sm">
            <p>
              <strong>{otherUserPending}</strong> unsynced{" "}
              {otherUserPending === 1 ? "change was" : "changes were"} saved on this device by
              another account. They are sent only when that account signs in here.
            </p>
            <div>
              <Button variant="outline" size="sm" onClick={() => setConfirmOther(true)}>
                <Trash2Icon aria-hidden="true" />
                Discard them
              </Button>
            </div>
            <ConfirmDialog
              open={confirmOther}
              onOpenChange={setConfirmOther}
              destructive
              title="Discard another account's changes?"
              description="They will be removed from this device and never sent. This can't be undone."
              confirmLabel="Discard"
              onConfirm={async () => {
                await discardOtherAccountsChanges();
                toast.success("Changes discarded");
              }}
            />
          </section>
        )}
      </SheetBody>
    </>
  );
}

function ItemSection({
  title,
  items,
  action,
}: {
  title: string;
  items: OutboxItem[];
  action?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {title} <span className="tabular-nums">({items.length})</span>
        </h3>
        {action}
      </div>
      <ul className="flex flex-col divide-y rounded-lg border">
        {items.map((item) => (
          <OutboxRow key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}

function OutboxRow({ item }: { item: OutboxItem }) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const badge = STATUS_BADGE[item.status];

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm font-medium break-words">{item.label}</p>
          <p className="text-xs text-muted-foreground">
            <time dateTime={new Date(item.createdAt).toISOString()} title={absoluteTime(item.createdAt)}>
              {relativeTime(item.createdAt)}
            </time>
            {item.attempts > 0 && ` · ${item.attempts} ${item.attempts === 1 ? "attempt" : "attempts"}`}
            {item.status === "pending" && item.attempts > 0 && item.nextAttemptAt > Date.now()
              ? ` · next try ${relativeTime(item.nextAttemptAt)}`
              : null}
          </p>
        </div>
        <Badge variant={badge.variant} className="shrink-0">
          {item.status === "syncing" && <Spinner decorative />}
          {badge.label}
        </Badge>
      </div>

      {item.lastError && item.status !== "synced" && (
        <p
          className={cn(
            "rounded-md px-2 py-1.5 text-xs",
            item.status === "failed" || item.status === "conflict"
              ? "bg-destructive/5 text-destructive"
              : "bg-muted text-muted-foreground",
          )}
        >
          {item.lastError}
        </p>
      )}
      {item.status === "conflict" && (
        <p className="text-xs text-muted-foreground">
          This was changed elsewhere after you edited it. <em>Retry with latest</em> applies your
          change on top of the latest version; <em>Discard</em> keeps the other change.
        </p>
      )}

      {item.status !== "synced" && item.status !== "syncing" && (
        <div className="flex flex-wrap gap-2">
          {item.status === "conflict" && (
            <Button
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => retryOutboxItemWithLatest(item.id))}
            >
              <RotateCcwIcon aria-hidden="true" />
              Retry with latest
            </Button>
          )}
          {(item.status === "failed" || (item.status === "pending" && item.attempts > 0)) && (
            <Button
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => retryOutboxItem(item.id))}
            >
              <RotateCcwIcon aria-hidden="true" />
              Retry
            </Button>
          )}
          <Button
            size="xs"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            disabled={busy}
            onClick={() => setConfirmDiscard(true)}
          >
            <Trash2Icon aria-hidden="true" />
            Discard
          </Button>
          <ConfirmDialog
            open={confirmDiscard}
            onOpenChange={setConfirmDiscard}
            destructive
            title="Discard this change?"
            description={`“${item.label}” will be removed from this device and never sent. This can't be undone.`}
            confirmLabel="Discard change"
            onConfirm={async () => {
              await discardOutboxItem(item.id);
              toast.success("Change discarded");
            }}
          />
        </div>
      )}
    </li>
  );
}
