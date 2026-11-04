import { Suspense } from "react";

import { AcceptInvitePage } from "@/features/members/accept-invite-page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AcceptInvitePage />
    </Suspense>
  );
}
