import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MIGRATIONS_DIR } from "./providers/postgres/client";

describe("MIGRATIONS_DIR", () => {
  const originalCwd = process.cwd();
  beforeAll(() => process.chdir(tmpdir()));
  afterAll(() => process.chdir(originalCwd));

  it("exists and contains _journal.json regardless of cwd", () => {
    expect(path.isAbsolute(MIGRATIONS_DIR)).toBe(true);
    expect(existsSync(MIGRATIONS_DIR)).toBe(true);
    expect(existsSync(path.join(MIGRATIONS_DIR, "meta/_journal.json"))).toBe(true);
  });
});
