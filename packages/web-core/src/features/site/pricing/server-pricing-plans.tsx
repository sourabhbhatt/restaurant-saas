import { connection } from "next/server";
import { Suspense } from "react";

import { PlansSkeleton, PricingPlans } from "./pricing-plans";
import { loadPublicPlans } from "./server-plans";

/** Exported for tests. */
export async function PlansFromServer({ variant }: { variant: "full" | "teaser" }) {
  await connection();
  const initial = await loadPublicPlans();
  // Without server data the client component fetches the plans itself.
  return <PricingPlans variant={variant} initial={initial ?? undefined} />;
}

/** Plan cards rendered on the server (prices in the HTML), hydrated into the live client view. */
export function ServerPricingPlans({ variant = "full" }: { variant?: "full" | "teaser" }) {
  return (
    <Suspense fallback={<PlansSkeleton />}>
      <PlansFromServer variant={variant} />
    </Suspense>
  );
}
