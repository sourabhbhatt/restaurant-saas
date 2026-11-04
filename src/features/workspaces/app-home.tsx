"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { PageSkeleton } from "@/components/shared/feedback";
import { AuthGate } from "@/features/session/auth-gate";
import { useMe } from "@/features/session/queries";

function Redirector() {
  const me = useMe();
  const router = useRouter();
  useEffect(() => {
    if (!me.data) return;
    const target = me.data.activeWorkspaceId ?? me.data.workspaces[0]?.id;
    router.replace(target ? `/app/w/${target}` : "/app/onboarding");
  }, [me.data, router]);
  return <PageSkeleton variant="cards" />;
}

/** /app: send the user to their active workspace, or to onboarding if they have none. */
export function AppHome() {
  return (
    <AuthGate>
      <Redirector />
    </AuthGate>
  );
}
