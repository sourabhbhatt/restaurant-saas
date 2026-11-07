import { beforeEach, describe, expect, it, vi } from "vitest";

const ownedClose = vi.fn(async () => {});

vi.mock("@/infrastructure/database/providers/postgres/client", () => ({
  connectPglite: vi.fn(async () => ({ db: {}, close: ownedClose })),
  connectPostgres: vi.fn(),
  runMigrations: vi.fn(async () => {
    throw new Error("migration boom");
  }),
}));

import { buildContainer } from "./container";
import { getEnv } from "./config/env";

describe("buildContainer cleanup on failed build", () => {
  beforeEach(() => ownedClose.mockClear());

  it("closes an owned handle when migrations fail and rethrows the original error", async () => {
    ownedClose.mockRejectedValueOnce(new Error("close boom"));
    await expect(
      buildContainer({
        env: { ...getEnv(), DATABASE_PROVIDER: "pglite" },
        migrate: true,
        quiet: true,
      }),
    ).rejects.toThrow("migration boom");
    expect(ownedClose).toHaveBeenCalledTimes(1);
  });

  it("does not close an injected handle", async () => {
    const injectedClose = vi.fn(async () => {});
    await expect(
      buildContainer({
        env: getEnv(),
        database: { db: {} as never, close: injectedClose },
        migrate: true,
        quiet: true,
      }),
    ).rejects.toThrow("migration boom");
    expect(injectedClose).not.toHaveBeenCalled();
  });
});
