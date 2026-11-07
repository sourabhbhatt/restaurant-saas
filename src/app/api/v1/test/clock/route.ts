import type { TestClockDto } from "@ros/contracts/platform";
import { testClockSchema } from "@ros/contracts/platform";
import { DomainError, notFound } from "@ros/domain/shared/errors";
import type { Container } from "@/server/container";
import type { UserActor } from "@/server/context";
import { route } from "@/server/http/route";

/**
 * Test clock (E2E only). Exists only when ENABLE_TEST_HOOKS=true (never in
 * production — env validation refuses it) and only for Super Admins; otherwise
 * it answers 404 as if it didn't exist.
 */
function guard(c: Container, actor: UserActor | null): void {
  if (!c.env.ENABLE_TEST_HOOKS) throw notFound("Route");
  if (!actor) throw new DomainError("UNAUTHENTICATED", "Please sign in to continue");
  c.access.requirePlatformAdmin(actor);
}

function snapshot(c: Container): TestClockDto {
  const offsetMs = c.clock.offsetMs();
  return { offsetMs, offsetDays: offsetMs / 86_400_000, now: c.clock.now().toISOString() };
}

export const GET = route({ auth: "optional" }, async ({ actor, c }) => {
  guard(c, actor);
  return { data: snapshot(c) };
});

export const POST = route({ auth: "optional" }, async ({ req, actor, c }) => {
  guard(c, actor);
  // Parsed here (not via route config) so a disabled hook always answers 404.
  const body = testClockSchema.parse(await req.json().catch(() => ({})));
  c.clock.setOffsetMs(Math.round(body.offsetDays * 86_400_000));
  c.logger.warn("test_clock_offset_changed", {
    offsetDays: body.offsetDays,
    userId: actor!.userId,
  });
  return { data: snapshot(c) };
});
