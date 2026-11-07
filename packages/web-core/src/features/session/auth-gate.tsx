"use client";

import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useSyncExternalStore, type ReactNode } from "react";

import { ErrorState, PageSkeleton } from "@ros/ui/shared/feedback";
import { ApiError, errorMessage } from "@ros/api-client";

import { useMe } from "./queries";

/**
 * Client-side gate for signed-in areas. This is a UX convenience only: every
 * API call is authorized on the server regardless of what the client renders.
 */
const subscribeNoop = () => () => {};
/** false on the server and during hydration, true afterwards. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

function AuthGateInner({
  children,
  requirePlatformAdmin = false,
}: {
  children: ReactNode;
  requirePlatformAdmin?: boolean;
}) {
  // Cached data (offline restore) can exist before hydration finishes; render the same
  // skeleton as the server until then so the first client render matches.
  const hydrated = useHydrated();
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;

  useEffect(() => {
    if (unauthenticated) router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
  }, [unauthenticated, router, pathname]);

  if (!hydrated || me.isPending || unauthenticated) return <PageSkeleton variant="detail" />;
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

export function AuthGate(props: { children: ReactNode; requirePlatformAdmin?: boolean }) {
  // usePathname() needs a Suspense boundary under cacheComponents.
  return (
    <Suspense fallback={<PageSkeleton variant="detail" />}>
      <AuthGateInner {...props} />
    </Suspense>
  );
}
