"use client";

import { ArrowLeft, Printer, QrCode } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, ErrorState, PageSkeleton } from "@ros/ui/shared/feedback";
import { Alert, AlertDescription } from "@ros/ui/ui/alert";
import { Button } from "@ros/ui/ui/button";
import { Spinner } from "@ros/ui/ui/spinner";
import { Toaster } from "@ros/ui/ui/sonner";
import { errorMessage } from "@ros/api-client";

import { svgDataUrl } from "./qr-download";
import { useGenerateQr, useQrSheet } from "./queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /print/tables?branchId=…&tableIds=… — branded A4 sheet of table QR codes. */
export function QrPrintSheet() {
  const params = useSearchParams();
  const branchId = params.get("branchId") ?? "";
  const tableIds = (params.get("tableIds") ?? "").split(",").filter((id) => UUID.test(id));
  const validBranch = UUID.test(branchId);
  const sheet = useQrSheet(validBranch ? branchId : "", tableIds);
  const generate = useGenerateQr();
  const [generating, setGenerating] = useState(false);

  if (!validBranch) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <EmptyState
          icon={<QrCode />}
          title="Choose tables to print"
          description="Open this page from Tables & QR in your branch."
        />
      </div>
    );
  }
  if (sheet.isPending) return <PageSkeleton variant="cards" />;
  if (sheet.isError) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorState
          title="Couldn't load QR codes"
          message={errorMessage(sheet.error)}
          onRetry={() => void sheet.refetch()}
        />
      </div>
    );
  }
  const data = sheet.data;

  const generateMissing = async () => {
    setGenerating(true);
    try {
      for (const t of data.missing) await generate.mutateAsync(t.id);
      toast.success(`${data.missing.length} QR codes generated`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setGenerating(false);
      void sheet.refetch();
    }
  };

  return (
    <div className="qr-sheet min-h-dvh bg-muted/40 print:bg-white">
      <Toaster />
      <style>{`
        @page { size: A4 portrait; margin: 12mm; }
        @media print {
          .qr-sheet { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .qr-card { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-[210mm] flex-wrap items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/app/b/${branchId}/tables`}>
              <ArrowLeft aria-hidden /> Tables
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-semibold">QR codes · {data.branchName}</h1>
            <p className="text-xs text-muted-foreground">
              {data.tables.length} codes · A4, 6 per page
            </p>
          </div>
          <Button onClick={() => window.print()} disabled={data.tables.length === 0}>
            <Printer aria-hidden /> Print
          </Button>
        </div>
        {data.missing.length > 0 && (
          <div className="mx-auto max-w-[210mm] px-4 pb-3">
            <Alert>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {data.missing.length} table{data.missing.length === 1 ? "" : "s"} without a QR
                  code:{" "}
                  {data.missing
                    .slice(0, 6)
                    .map((t) => t.name)
                    .join(", ")}
                  {data.missing.length > 6 ? "…" : ""}
                </span>
                <Button size="sm" onClick={() => void generateMissing()} disabled={generating}>
                  {generating && <Spinner decorative />}
                  Generate missing
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        )}
      </header>

      {data.tables.length === 0 ? (
        <div className="mx-auto max-w-lg p-6 print:hidden">
          <EmptyState
            icon={<QrCode />}
            title="Nothing to print yet"
            description="Generate QR codes for your tables first."
          />
        </div>
      ) : (
        <main className="mx-auto grid max-w-[210mm] grid-cols-1 gap-4 p-4 sm:grid-cols-2 print:max-w-none print:grid-cols-2 print:gap-[6mm] print:p-0">
          {data.tables.map((t) => (
            <article
              key={t.tableId}
              className="qr-card flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed bg-white p-6 text-center text-neutral-900 print:h-[86mm] print:justify-center print:p-[5mm]"
            >
              <p className="text-sm font-semibold tracking-wide text-neutral-500 uppercase">
                {data.restaurantName}
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element -- inline SVG data URL */}
              <img
                src={svgDataUrl(t.svg)}
                alt={`QR code for ${t.tableName}`}
                className="size-44 print:size-[52mm]"
              />
              <p className="text-3xl leading-none font-bold">{t.tableName}</p>
              <p className="text-base font-medium">Scan to order</p>
              <p className="text-xs text-neutral-500">
                Point your phone camera at the code · {data.branchName}
              </p>
            </article>
          ))}
        </main>
      )}
    </div>
  );
}
