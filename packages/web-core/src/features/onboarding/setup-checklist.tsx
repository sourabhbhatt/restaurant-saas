"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Circle, ExternalLink, X } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@ros/ui/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ros/ui/ui/card";
import { Progress } from "@ros/ui/ui/progress";
import { cn } from "@ros/ui/utils";
import { api, errorMessage } from "@ros/api-client";

import { analyticsKeys, useWorkspaceDetail } from "../analytics/queries";
import { appHref, useAppLinks } from "../../app-links";

import { useBranchSetupProgress, type SetupStepKey } from "./setup-progress";

interface Step {
  key: SetupStepKey;
  title: string;
  description: string;
  action: { href: string; label: string; external?: boolean } | null;
}

function StepLink({
  href,
  external,
  primary,
  children,
}: {
  href: string;
  external?: boolean;
  primary: boolean;
  children: ReactNode;
}) {
  return (
    <Button asChild size="sm" variant={primary ? "default" : "outline"}>
      {external ? (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children} <ExternalLink aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : (
        <Link href={href}>
          {children} <ArrowRight aria-hidden />
        </Link>
      )}
    </Button>
  );
}

/**
 * "Get ready for your first order": a short checklist for workspace owners,
 * driven by the branch's real menu, tables, QR codes and orders. It hides
 * itself once everything is done, and can be hidden for good (server-side,
 * the same flag as the onboarding wizard) at any time.
 */
export function SetupChecklist({
  workspaceId,
  branchId,
  branchName,
  className,
}: {
  workspaceId: string;
  branchId: string;
  /** Shown when the checklist sits outside the branch (workspace overview). */
  branchName?: string;
  className?: string;
}) {
  const qc = useQueryClient();
  const links = useAppLinks();
  const detail = useWorkspaceDetail(workspaceId);
  const dismissed = Boolean(detail.data?.workspace.onboarding.dismissedAt);
  const progress = useBranchSetupProgress(branchId, detail.isSuccess && !dismissed);
  const hide = useMutation({
    mutationFn: () => api.put(`/workspaces/${workspaceId}/onboarding`, { dismiss: true }),
    onSuccess: async () => {
      toast.success("Setup checklist hidden");
      await qc.invalidateQueries({ queryKey: analyticsKeys.workspaceDetail(workspaceId) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (!detail.isSuccess || dismissed || !progress.ready) return null;
  const { done } = progress;
  const steps: Step[] = [
    {
      key: "menu",
      title: "Add your dishes",
      description: "Guests order from this menu. Start with a few bestsellers; add photos later.",
      action: { href: `/app/b/${branchId}/menu`, label: "Open menu" },
    },
    {
      key: "tables",
      title: "Add your tables",
      description: "One entry per table, for example T1 to T10.",
      action: { href: `/app/b/${branchId}/tables`, label: "Add tables" },
    },
    {
      key: "qr",
      title: "Print table QR codes",
      description: "Each table gets its own code. Guests scan it with their phone camera — no app.",
      action: { href: `/print/tables?branchId=${branchId}`, label: "Print QR codes" },
    },
    {
      key: "test-order",
      title: "Place a test order",
      description: progress.guestUrl
        ? "Open a table's guest menu, add a dish and place the order — exactly what guests see."
        : "Available once a table has a QR code.",
      action: progress.guestUrl
        ? { href: progress.guestUrl, label: "Open guest menu", external: true }
        : null,
    },
    {
      key: "accept",
      title: "Accept it as a waiter",
      description:
        "New orders wait for a waiter to accept them, then appear on the Kitchen display.",
      action: done["test-order"]
        ? {
            href: appHref(links.ops, `/waiter/${branchId}`),
            label: "Open waiter console",
            external: true,
          }
        : null,
    },
  ];

  const completed = steps.filter((s) => done[s.key]).length;
  if (completed === steps.length) return null;
  const next = steps.find((s) => !done[s.key])?.key;
  const pct = Math.round((completed / steps.length) * 100);

  return (
    <Card
      className={cn("gap-4 border-primary/30 bg-primary/[0.03]", className)}
      aria-labelledby="setup-checklist-title"
    >
      <CardHeader>
        <CardTitle id="setup-checklist-title" className="text-base">
          <h2>Get ready for your first order</h2>
        </CardTitle>
        <CardDescription>
          {completed} of {steps.length} done
          {branchName ? ` for ${branchName}` : ""} · about 10 minutes in total.
        </CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Hide setup checklist"
            title="Hide setup checklist"
            disabled={hide.isPending}
            onClick={() => hide.mutate()}
          >
            <X aria-hidden />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Progress value={pct} aria-label="Setup progress" />
        <ol className="flex flex-col divide-y">
          {steps.map((s) => {
            const isDone = done[s.key];
            const action = s.action;
            return (
              <li
                key={s.key}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0"
                aria-current={s.key === next ? "step" : undefined}
              >
                {isDone ? (
                  <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden />
                ) : (
                  <Circle className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <div className="min-w-0 flex-1 basis-48">
                  <p className={cn("text-sm font-medium", isDone && "text-muted-foreground")}>
                    {s.title}
                    <span className="sr-only">{isDone ? " (done)" : " (to do)"}</span>
                  </p>
                  {!isDone && <p className="text-sm text-muted-foreground">{s.description}</p>}
                </div>
                {!isDone && action ? (
                  <div className="max-sm:w-full max-sm:pl-8 max-sm:*:w-full">
                    <StepLink
                      href={action.href}
                      external={action.external}
                      primary={s.key === next}
                    >
                      {action.label}
                    </StepLink>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
