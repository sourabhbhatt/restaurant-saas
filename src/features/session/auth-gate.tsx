"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { ErrorState, PageSkeleton } from "@/components/shared/feedback";
import { ApiError, errorMessage } from "@/lib/api-client";

import { useMe } from "./queries";

/**
 * Client-side gate for signed-in areas. This is a UX convenience only: every
 * API call is authorized on the server regardless of what the client renders.
 */
export function AuthGate({
  children,
  requirePlatformAdmin = false,
}: {
  children: ReactNode;
  requirePlatformAdmin?: boolean;
}) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;

  useEffect(() => {
    if (unauthenticated) router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
  }, [unauthenticated, router, pathname]);

  if (me.isPending || unauthenticated) return <PageSkeleton variant="detail" />;
  if (me.isError) {
    return (
      <ErrorState
        title="We couldn't load your account"
        message={errorMessage(me.error)}
        onRetry={() => void me.refetch()}
      />
    );
  }
  if (requirePlatformAdmin && !me.data.user.isPlatformAdmin) {
    return (
      <ErrorState
        title="Access denied"
        message="This area is restricted to platform administrators."
      />
    );
  }
  return <>{children}</>;
}
