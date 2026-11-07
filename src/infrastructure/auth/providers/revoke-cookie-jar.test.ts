import { describe, expect, it } from "vitest";

import { users } from "@/infrastructure/database/providers/postgres/schema";
import { createTestContainer } from "@/test/harness";

import { revokeSessionsFromCookieJar } from "./revoke-cookie-jar";

const jar = (lines: string[]) => lines.join("\n") + "\n";
const cookie = (name: string, value: string, httpOnly = true) =>
  `${httpOnly ? "#HttpOnly_" : ""}localhost\tFALSE\t/\tFALSE\t0\t${name}\t${value}`;

async function sessionToken() {
  const c = await createTestContainer();
  const [user] = await c.db
    .insert(users)
    .values({ email: "jar@example.com", name: "Jar" })
    .returning({ id: users.id });
  const { token } = await c.identity.issueSession(user!.id, { ip: null, userAgent: null });
  return { c, token };
}

describe("revokeSessionsFromCookieJar", () => {
  it("revokes the session named in a jar and resolveSession returns null", async () => {
    const { c, token } = await sessionToken();
    expect(await c.identity.resolveSession(token)).not.toBeNull();
    const result = await revokeSessionsFromCookieJar(
      c.db,
      jar(["# Netscape HTTP Cookie File", cookie("ros_session", token)]),
      new Date(),
    );
    expect(result).toEqual({ found: 1, revoked: 1 });
    expect(await c.identity.resolveSession(token)).toBeNull();
  });

  it("second run revokes nothing", async () => {
    const { c, token } = await sessionToken();
    const text = jar([cookie("ros_session", token)]);
    await revokeSessionsFromCookieJar(c.db, text, new Date());
    expect(await revokeSessionsFromCookieJar(c.db, text, new Date())).toEqual({
      found: 1,
      revoked: 0,
    });
  });

  it("ignores comment lines and other cookies", async () => {
    const { c, token } = await sessionToken();
    const text = jar([
      "# Netscape HTTP Cookie File",
      "# a comment",
      cookie("other", token),
      cookie("ros_csrf", token, false),
    ]);
    expect(await revokeSessionsFromCookieJar(c.db, text, new Date())).toEqual({
      found: 0,
      revoked: 0,
    });
    expect(await c.identity.resolveSession(token)).not.toBeNull();
  });
});
