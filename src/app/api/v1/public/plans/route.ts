import { platformService } from "@/composition/platform";
import { route } from "@ros/application/http/route";

/** Public, ACTIVE plans for the pricing page and upgrade modal (no internal fields). */
export const GET = route({ auth: "public" }, async ({ c }) => {
  return { data: await platformService(c).listPublicPlans() };
});
