import { afterEach, describe, expect, it } from "vitest";

import { appOriginAllowed, getEnv, resetEnvCache, tenantRole } from "./env";

afterEach(() => {
  delete process.env.DATABASE_TENANT_ROLE;
  delete process.env.ALLOWED_ORIGINS;
  for (const key of [
    "PAYMENT_PROVIDER",
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "RAZORPAY_WEBHOOK_SECRET",
  ])
    delete process.env[key];
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

describe("PAYMENT_PROVIDER", () => {
  it("defaults to none", () => {
    expect(getEnv().PAYMENT_PROVIDER).toBe("none");
  });

  it("razorpay without secrets fails startup, naming the missing variables", () => {
    process.env.PAYMENT_PROVIDER = "razorpay";
    process.env.RAZORPAY_KEY_ID = "rzp_test_key";
    resetEnvCache();
    expect(() => getEnv()).toThrow(
      "PAYMENT_PROVIDER=razorpay requires RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET",
    );
  });

  it("razorpay with every secret starts", () => {
    process.env.PAYMENT_PROVIDER = "razorpay";
    process.env.RAZORPAY_KEY_ID = "rzp_test_key";
    process.env.RAZORPAY_KEY_SECRET = "s";
    process.env.RAZORPAY_WEBHOOK_SECRET = "w";
    resetEnvCache();
    expect(getEnv().PAYMENT_PROVIDER).toBe("razorpay");
  });
});
