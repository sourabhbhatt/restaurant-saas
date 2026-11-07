import type { Container } from "@/composition/container";
import { SESSION_COOKIE } from "@ros/application/http/cookies";

import { makePlatformAdmin } from "./harness";
import { signUpUser, type TestUser } from "./fixtures";

const DAY_MS = 86_400_000;

export async function signUpAdmin(c: Container, name = "Platform Admin"): Promise<TestUser> {
  const user = await signUpUser(name);
  await makePlatformAdmin(c, user.userId);
  return user;
}

/**
 * A new session cookie valid at the *current* (possibly shifted) clock time.
 * Sessions issued before a large clock offset expire, exactly as in production.
 */
export async function freshCookie(c: Container, userId: string): Promise<string> {
  const session = await c.identity.issueSession(userId, { ip: null, userAgent: "vitest" });
  return `${SESSION_COOKIE}=${encodeURIComponent(session.token)}`;
}

export function setClockDays(c: Container, days: number): void {
  c.clock.setOffsetMs(Math.round(days * DAY_MS));
}
