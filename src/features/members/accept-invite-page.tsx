"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { ErrorState, PageSkeleton } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AcceptInvitationResultDto, InvitationPreviewDto } from "@ros/contracts/tenancy";
import { useMe } from "@/features/session/queries";
import { api, errorMessage } from "@/lib/api-client";
import { useAction } from "@/lib/use-action";

export function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const me = useMe();
  const preview = useQuery({
    queryKey: ["invitation", token],
    queryFn: ({ signal }) =>
      api.get<InvitationPreviewDto>(`/invitations/${token}`, undefined, signal),
    retry: false,
  });
  const { pending, run } = useAction();
  if (preview.isPending || me.isPending) return <PageSkeleton variant="detail" />;
  if (preview.isError)
    return <ErrorState title="Invitation not found" message={errorMessage(preview.error)} />;
  const p = preview.data;
  const next = encodeURIComponent(`/invite/${token}`);
  const signedIn = Boolean(me.data);
  const wrongEmail = signedIn && me.data!.user.email.toLowerCase() !== p.email.toLowerCase();
  const usable = p.status === "PENDING" && !p.expired;
  return (
    <div className="mx-auto flex min-h-dvh max-w-md items-center px-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Join {p.workspaceName}</CardTitle>
          <CardDescription>
            {p.inviterName ? `${p.inviterName} invited` : "You were invited"} {p.email} as{" "}
            {p.roleName}
            {p.assignmentRoleName
              ? ` (${p.assignmentRoleName} at ${p.branchName ?? p.restaurantName})`
              : ""}
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!usable ? (
            <p className="text-sm text-destructive" role="alert">
              This invitation is {p.expired ? "expired" : p.status.toLowerCase()}. Ask the workspace
              owner for a new one.
            </p>
          ) : !signedIn ? (
            <>
              <Button asChild>
                <Link href={`/sign-up?next=${next}`}>Create an account</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href={`/sign-in?next=${next}`}>I already have an account</Link>
              </Button>
              <p className="text-xs text-muted-foreground">Use the email {p.email}.</p>
            </>
          ) : wrongEmail ? (
            <p className="text-sm text-destructive" role="alert">
              You are signed in as {me.data!.user.email}, but this invitation is for {p.email}. Sign
              out and use that account.
            </p>
          ) : (
            <Button
              disabled={pending}
              onClick={async () => {
                const res = await run(() =>
                  api.post<AcceptInvitationResultDto>(`/invitations/${token}/accept`),
                );
                if (res)
                  router.push(
                    res.branchId ? `/app/b/${res.branchId}` : `/app/w/${res.workspaceId}`,
                  );
              }}
            >
              {pending ? "Joining…" : "Accept invitation"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
