"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { InboxIcon, MailIcon, RefreshCwIcon } from "lucide-react";

import { EmptyState, ErrorState, LoadingState } from "@/components/shared/feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DevMailboxEmailDto } from "@ros/contracts/dev-mailbox";
import { api, ApiError, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import { Linkify } from "./linkify";

const STATUS_VARIANT = { SENT: "success", PENDING: "warning", FAILED: "destructive" } as const;

const fmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "medium" });

export function DevMailbox() {
  const query = useQuery({
    queryKey: ["dev", "mailbox"],
    queryFn: ({ signal }) => api.get<DevMailboxEmailDto[]>("/dev/mailbox", undefined, signal),
    retry: false,
    refetchInterval: 5_000,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dev mailbox</h1>
        <p className="text-sm text-muted-foreground">
          The latest 50 emails written to the outbox. Available only in development or with test
          hooks enabled. Refreshes every 5 seconds.
        </p>
      </div>
      <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
        <RefreshCwIcon
          aria-hidden="true"
          className={cn(query.isFetching && "motion-safe:animate-spin")}
        />
        Refresh
      </Button>
    </div>
  );

  let body;
  if (query.isPending) {
    body = <LoadingState label="Loading emails…" />;
  } else if (query.isError) {
    const disabled = query.error instanceof ApiError && query.error.status === 404;
    body = disabled ? (
      <EmptyState
        icon={<InboxIcon />}
        title="The dev mailbox is disabled"
        description="It is only available when NODE_ENV=development or ENABLE_TEST_HOOKS=true."
      />
    ) : (
      <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
    );
  } else if (query.data.length === 0) {
    body = (
      <EmptyState
        icon={<InboxIcon />}
        title="No emails yet"
        description="Sign up, request a password reset or invite a staff member — the email will appear here."
      />
    );
  } else {
    const emails = query.data;
    const selected = emails.find((e) => e.id === selectedId) ?? emails[0]!;
    body = (
      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <ul className="flex max-h-[70dvh] flex-col divide-y overflow-y-auto rounded-xl border bg-card">
          {emails.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => setSelectedId(e.id)}
                aria-current={e.id === selected.id ? "true" : undefined}
                className={cn(
                  "flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-accent/60",
                  e.id === selected.id && "bg-accent",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{e.subject}</span>
                  <Badge variant={STATUS_VARIANT[e.status]}>{e.status}</Badge>
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {e.to} · {fmt.format(new Date(e.createdAt))}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <EmailDetail email={selected} />
      </div>
    );
  }

  return (
    <main id="main" className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      {header}
      {body}
    </main>
  );
}

function EmailDetail({ email }: { email: DevMailboxEmailDto }) {
  return (
    <article className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-5">
      <header className="flex flex-col gap-2 border-b pb-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <MailIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          {email.subject}
        </h2>
        <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">To</dt>
          <dd className="break-all">{email.to}</dd>
          <dt className="text-muted-foreground">Template</dt>
          <dd>{email.template}</dd>
          <dt className="text-muted-foreground">Created</dt>
          <dd>{fmt.format(new Date(email.createdAt))}</dd>
          <dt className="text-muted-foreground">Provider</dt>
          <dd>{email.provider ?? "outbox"}</dd>
          {email.lastError && (
            <>
              <dt className="text-destructive">Error</dt>
              <dd className="text-destructive">{email.lastError}</dd>
            </>
          )}
        </dl>
      </header>
      <div className="text-sm leading-relaxed break-words whitespace-pre-wrap">
        <Linkify text={email.text} />
      </div>
      {email.html && (
        <details className="rounded-lg border">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium">HTML version</summary>
          {/* Sandboxed: no scripts, links open in a new tab. */}
          <iframe
            title={`HTML version of ${email.subject}`}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            srcDoc={`<base target="_blank">${email.html}`}
            className="h-[28rem] w-full rounded-b-lg border-t bg-white"
          />
        </details>
      )}
    </article>
  );
}
