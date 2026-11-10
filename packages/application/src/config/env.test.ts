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

  it("razorpay with every secret and a test key starts", () => {
    process.env.PAYMENT_PROVIDER = "razorpay";
    process.env.RAZORPAY_KEY_ID = "rzp_test_key";
    process.env.RAZORPAY_KEY_SECRET = "s";
    process.env.RAZORPAY_WEBHOOK_SECRET = "w";
    resetEnvCache();
    expect(getEnv().PAYMENT_PROVIDER).toBe("razorpay");
    expect(getEnv().RAZORPAY_KEY_ID).toBe("rzp_test_key");
  });

  it.each(["rzp_live_key", "live_key", "RZP_TEST_upper"])(
    "refuses a key id that is not a test key (%s), with no override",
    (keyId) => {
      process.env.PAYMENT_PROVIDER = "razorpay";
      process.env.RAZORPAY_KEY_ID = keyId;
      process.env.RAZORPAY_KEY_SECRET = "s";
      process.env.RAZORPAY_WEBHOOK_SECRET = "w";
      resetEnvCache();
      expect(() => getEnv()).toThrow(
        "Live Razorpay keys are not allowed: use a rzp_test_ key (test mode only)",
      );
    },
  );

  it("a live key is ignored while the provider is none", () => {
    process.env.RAZORPAY_KEY_ID = "rzp_live_key";
    resetEnvCache();
    expect(getEnv().PAYMENT_PROVIDER).toBe("none");
  });
});

describe("PROXY_SHARED_SECRET", () => {
  afterEach(() => {
    delete process.env.PROXY_SHARED_SECRET;
    resetEnvCache();
  });

  it("is optional (signed client IP off)", () => {
    expect(getEnv().PROXY_SHARED_SECRET).toBeUndefined();
  });

  it("rejects a short secret", () => {
    process.env.PROXY_SHARED_SECRET = "too-short";
    resetEnvCache();
    expect(() => getEnv()).toThrow(/PROXY_SHARED_SECRET/);
  });

  it("accepts a 16+ character secret", () => {
    process.env.PROXY_SHARED_SECRET = "a-long-enough-shared-secret";
    resetEnvCache();
    expect(getEnv().PROXY_SHARED_SECRET).toBe("a-long-enough-shared-secret");
  });

  it("in production refuses the example placeholder", () => {
    const previous = { NODE_ENV: process.env.NODE_ENV, APP_SECRET: process.env.APP_SECRET };
    Object.assign(process.env, {
      NODE_ENV: "production",
      APP_SECRET: "a".repeat(40),
      TRUSTED_PROXY_HOPS: "1",
      PROXY_SHARED_SECRET: "replace-with-another-long-random-string",
    });
    resetEnvCache();
    try {
      expect(() => getEnv()).toThrow(/PROXY_SHARED_SECRET/);
      process.env.PROXY_SHARED_SECRET = "0123456789abcdef0123456789abcdef";
      resetEnvCache();
      expect(getEnv().PROXY_SHARED_SECRET).toHaveLength(32);
    } finally {
      Object.assign(process.env, previous);
      delete process.env.TRUSTED_PROXY_HOPS;
      resetEnvCache();
    }
  });
});
