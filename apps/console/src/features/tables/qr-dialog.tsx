"use client";

import { Ban, Copy, Download, ExternalLink, QrCode, RefreshCw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ConfirmDialog, EmptyState, ErrorState, LoadingState } from "@ros/ui/shared/feedback";
import { Button } from "@ros/ui/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@ros/ui/ui/dialog";
import { Spinner } from "@ros/ui/ui/spinner";
import type { TableDto } from "@ros/contracts/tables";
import { ApiError, errorMessage } from "@ros/api-client";

import { downloadPng, downloadSvg, safeFilename, svgDataUrl } from "./qr-download";
import { useGenerateQr, useRevokeQr, useTableQr } from "./queries";

/** QR preview with copy / download (SVG, PNG) / regenerate / revoke. */
export function QrDialog({
  table,
  onOpenChange,
}: {
  table: TableDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={table !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {table && <QrBody key={table.id} table={table} />}
      </DialogContent>
    </Dialog>
  );
}

function QrBody({ table }: { table: TableDto }) {
  const qr = useTableQr(table.id, table.qr.active);
  const generate = useGenerateQr();
  const revoke = useRevokeQr();
  const [confirm, setConfirm] = useState<"regenerate" | "revoke" | null>(null);
  const [pngPending, setPngPending] = useState(false);

  const missing = !table.qr.active || (qr.error instanceof ApiError && qr.error.status === 404);
  const data = generate.data?.tableId === table.id ? generate.data : qr.data;
  const file = `qr-${safeFilename(table.name)}`;

  const onGenerate = async () => {
    try {
      await generate.mutateAsync(table.id);
      toast.success(`QR code ready for ${table.name}`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  let body: ReactNode;
  if (missing && !generate.data) {
    body = (
      <EmptyState
        size="compact"
        icon={<QrCode />}
        title="No QR code yet"
        description="Generate a code, then print it and place it on the table."
        action={
          <Button onClick={() => void onGenerate()} disabled={generate.isPending}>
            {generate.isPending ? <Spinner decorative /> : <QrCode aria-hidden />}
            Generate QR code
          </Button>
        }
      />
    );
  } else if (!data && qr.isPending) {
    body = <LoadingState label="Loading QR code…" className="py-12" />;
  } else if (!data) {
    body = (
      <ErrorState
        size="compact"
        message={errorMessage(qr.error)}
        onRetry={() => void qr.refetch()}
        retrying={qr.isFetching}
      />
    );
  } else {
    body = (
      <div className="flex flex-col items-center gap-4">
        <div className="rounded-xl border bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URL */}
          <img
            src={svgDataUrl(data.svg)}
            alt={`QR code for ${table.name}`}
            className="size-56"
            width={224}
            height={224}
          />
        </div>
        <div className="flex w-full items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          <code className="min-w-0 flex-1 truncate text-xs" title={data.url}>
            {data.url}
          </code>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy link"
            onClick={() =>
              void navigator.clipboard
                .writeText(data.url)
                .then(() => toast.success("Link copied"))
                .catch(() => toast.error("Couldn't copy. Select the link and copy it manually."))
            }
          >
            <Copy aria-hidden />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Created {new Date(data.createdAt).toLocaleString()}
        </p>
        <Button asChild className="w-full">
          <a href={data.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden /> Open guest menu
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </Button>
        <p className="-mt-2 text-center text-xs text-muted-foreground">
          Try it: place a test order exactly as a guest at {table.name} would.
        </p>
        <div className="grid w-full grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => downloadSvg(data.svg, `${file}.svg`)}>
            <Download aria-hidden /> SVG
          </Button>
          <Button
            variant="outline"
            disabled={pngPending}
            onClick={async () => {
              setPngPending(true);
              try {
                await downloadPng(data.svg, `${file}.png`);
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Download failed");
              } finally {
                setPngPending(false);
              }
            }}
          >
            {pngPending ? <Spinner decorative /> : <Download aria-hidden />} PNG
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>QR code · {table.name}</DialogTitle>
        <DialogDescription>
          Guests scan this code to see the menu and order from {table.name}.
        </DialogDescription>
      </DialogHeader>
      {body}
      {data && (
        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirm("revoke")}
          >
            <Ban aria-hidden /> Revoke QR code
          </Button>
          <Button variant="outline" onClick={() => setConfirm("regenerate")}>
            <RefreshCw aria-hidden /> Regenerate QR code
          </Button>
        </DialogFooter>
      )}
      <ConfirmDialog
        open={confirm === "regenerate"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Regenerate the QR code for ${table.name}?`}
        description="The printed code on this table stops working immediately. Print and place the new code before guests arrive."
        confirmLabel="Regenerate QR code"
        destructive
        getErrorMessage={errorMessage}
        onConfirm={async () => {
          await generate.mutateAsync(table.id);
          toast.success("New QR code generated. Print and replace the old one.");
        }}
      />
      <ConfirmDialog
        open={confirm === "revoke"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Revoke the QR code for ${table.name}?`}
        description="Guests can no longer open this table by scanning. You can generate a new code at any time."
        confirmLabel="Revoke QR code"
        destructive
        getErrorMessage={errorMessage}
        onConfirm={async () => {
          await revoke.mutateAsync(table.id);
          generate.reset();
          toast.success("QR code revoked");
        }}
      />
    </>
  );
}
