import { describe, expect, it } from "vitest";

import { generateToken } from "@ros/domain/shared/tokens";

import { loggablePath, requestIdFrom } from "./route";

describe("loggablePath", () => {
  it("masks QR and invitation tokens but keeps ids and static segments", () => {
    const token = generateToken();
    expect(loggablePath(`/api/v1/public/qr/${token}/session`)).toBe(
      "/api/v1/public/qr/[token]/session",
    );
    expect(loggablePath(`/api/v1/invitations/${token}/accept`)).toBe(
      "/api/v1/invitations/[token]/accept",
    );
    const id = "6e0bb2bb-13ed-46bd-ac46-491be4e2f6e9";
    expect(loggablePath(`/api/v1/workspaces/${id}/members`)).toBe(
      `/api/v1/workspaces/${id}/members`,
    );
  });
});

const withId = (id: string) =>
  new Request("http://api.local/api/v1/health", { headers: { "x-request-id": id } });

describe("requestIdFrom", () => {
  it("echoes a plain client-supplied id", () => {
    expect(requestIdFrom(withId("trace-1234.abcd:ef"))).toBe("trace-1234.abcd:ef");
  });

  it("generates an id when none is supplied", () => {
    expect(requestIdFrom(new Request("http://api.local/api/v1/health"))).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("replaces ids that are too long or carry unexpected characters", () => {
    for (const bad of ["a".repeat(65), "id with spaces", "xé", "<script>", "a;b", ""]) {
      const id = requestIdFrom(withId(bad));
      expect(id).not.toBe(bad);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});
