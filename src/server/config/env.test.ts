import { afterEach, describe, expect, it } from "vitest";

import { getEnv, resetEnvCache, tenantRole } from "./env";

afterEach(() => {
  delete process.env.DATABASE_TENANT_ROLE;
  resetEnvCache();
});

describe("DATABASE_TENANT_ROLE", () => {
  it("defaults to ros_tenant", () => {
    delete process.env.DATABASE_TENANT_ROLE;
    resetEnvCache();
    expect(tenantRole(getEnv())).toBe("ros_tenant");
  });

  it("none disables the role switch", () => {
    process.env.DATABASE_TENANT_ROLE = "none";
    resetEnvCache();
    expect(tenantRole(getEnv())).toBeNull();
  });

  it("rejects values that are not plain role identifiers", () => {
    process.env.DATABASE_TENANT_ROLE = "ros_tenant; reset role";
    resetEnvCache();
    expect(() => getEnv()).toThrow(/DATABASE_TENANT_ROLE/);
  });
});
