import { afterEach, describe, expect, it } from "vitest";

import { appOriginAllowed, getEnv, resetEnvCache, tenantRole } from "./env";

afterEach(() => {
  delete process.env.DATABASE_TENANT_ROLE;
  delete process.env.ALLOWED_ORIGINS;
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

describe("ALLOWED_ORIGINS", () => {
  it.each(["ftp://files.example", "https://*.example.com", "not a url"])(
    "rejects %s at startup",
    (value) => {
      process.env.ALLOWED_ORIGINS = `https://ok.example,${value}`;
      resetEnvCache();
      expect(() => getEnv()).toThrow(/ALLOWED_ORIGINS/);
    },
  );

  it("flags a list that leaves out APP_URL's origin", () => {
    expect(appOriginAllowed(getEnv())).toBe(true);
    process.env.ALLOWED_ORIGINS = "https://other.example";
    resetEnvCache();
    expect(appOriginAllowed(getEnv())).toBe(false);
  });
});
