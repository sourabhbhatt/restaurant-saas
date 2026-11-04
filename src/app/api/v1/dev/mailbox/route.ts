import { DEV_MAILBOX_LIMIT } from "@/contracts/dev-mailbox";
import { DomainError } from "@/domain/shared/errors";
import { devMailbox } from "@/server/composition/dev-mailbox";
import { route } from "@/server/http/route";

/**
 * Local email viewer for testing sign-up, reset and invite flows without a
 * real email provider. 404 unless NODE_ENV=development or ENABLE_TEST_HOOKS.
 */
export const GET = route({ auth: "public" }, async ({ c }) => {
  const mailbox = devMailbox(c);
  if (!mailbox.enabled) throw new DomainError("NOT_FOUND", "Not found");
  return { data: await mailbox.repository.latest(DEV_MAILBOX_LIMIT) };
});
