"use client";

import { DoorClosed, Info } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { BillDto } from "@ros/contracts/billing";
import { ConfirmDialog } from "@/components/shared/feedback";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError, errorMessage } from "@/lib/api-client";

import { money } from "../format";
import { closureReasons, useCloseSession } from "../queries";
import { NeedsConnectionNote, useIsOffline } from "@/features/offline";

interface Props {
  branchId: string;
  bill: BillDto;
  /** Branch rule when known; undefined leaves the decision to the server's 409 reasons. */
  requireFullPayment?: boolean;
  onClosed?: () => void;
}

/** "Close table" with the reasons it can't be closed yet (client hint + server rules). */
export function CloseTable({ branchId, bill, requireFullPayment, onClosed }: Props) {
  const [open, setOpen] = useState(false);
  const [serverReasons, setServerReasons] = useState<string[]>([]);
  const close = useCloseSession(branchId);
  const offline = useIsOffline();

  if (bill.status === "CLOSED") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Info className="size-4" aria-hidden /> This table has been closed.
      </p>
    );
  }
  if (bill.status === "VOID") return null;

  const clientReasons =
    requireFullPayment === true && bill.balanceDue > 0
      ? [`Collect the outstanding ${money(bill.balanceDue, bill.currency)} before closing`]
      : [];
  const reasons = clientReasons.length ? clientReasons : serverReasons;

  return (
    <div className="flex flex-col gap-2">
      {reasons.length > 0 && (
        <Alert>
          <Info aria-hidden />
          <AlertTitle>Table can&apos;t be closed yet</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <Button
        variant={clientReasons.length ? "outline" : "success"}
        size="lg"
        disabled={clientReasons.length > 0 || close.isPending || offline}
        onClick={() => setOpen(true)}
      >
        <DoorClosed aria-hidden /> Close table
      </Button>
      <NeedsConnectionNote>Closing a table needs a connection.</NeedsConnectionNote>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Close ${bill.tableName}?`}
        description={
          bill.balanceDue > 0
            ? `The bill still has ${money(bill.balanceDue, bill.currency)} outstanding. Served orders will be marked completed and the table freed.`
            : "Served orders will be marked completed and the table will be available for new guests."
        }
        confirmLabel="Close table"
        pendingLabel="Closing…"
        getErrorMessage={errorMessage}
        onConfirm={async () => {
          try {
            const result = await close.mutateAsync({ sessionId: bill.sessionId, billId: bill.id });
            setServerReasons([]);
            toast.success(
              `${bill.tableName} closed${result.completedOrders ? ` · ${result.completedOrders} order(s) completed` : ""}`,
            );
            onClosed?.();
          } catch (error) {
            if (error instanceof ApiError && error.status === 409) {
              const r = closureReasons(error);
              if (r.length) {
                setServerReasons(r);
                return;
              }
            }
            throw error;
          }
        }}
      />
    </div>
  );
}
