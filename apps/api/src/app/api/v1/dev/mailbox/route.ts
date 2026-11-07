import { DEV_MAILBOX_LIMIT } from "@ros/contracts/dev-mailbox";
import { DomainError } from "@ros/domain/shared/errors";
import { devMailbox } from "@/composition/dev-mailbox";
import { route } from "@ros/application/http/route";

/**
 * Local email viewer for testing sign-up, reset and invite flows without a
 * real email provider. It exposes every account's tokens, so like the test
 * clock it exists only with ENABLE_TEST_HOOKS=true and only for Super Admins;
 * otherwise it answers 404 as if it didn't exist.
 */
export const GET = route({ auth: "optional" }, async ({ actor, c }) => {
  const mailbox = devMailbox(c);
  if (!mailbox.enabled) throw new DomainError("NOT_FOUND", "Not found");
  if (!actor) throw new DomainError("UNAUTHENTICATED", "Please sign in to continue");
  c.access.requirePlatformAdmin(actor);
  return { data: await mailbox.repository.latest(DEV_MAILBOX_LIMIT) };
});
