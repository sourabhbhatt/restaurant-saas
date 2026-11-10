import { TenantContextError, UniqueViolationError } from "./transaction";

// Production bundles hold one copy of this module per API route; the shared
// container's adapters throw with their own copy.
describe("adapter errors across module copies", () => {
  it("UniqueViolationError and TenantContextError keep instanceof", async () => {
    vi.resetModules();
    const other = await import("./transaction");
    expect(other.UniqueViolationError).not.toBe(UniqueViolationError);
    const unique = new other.UniqueViolationError("tables_name_uq");
    expect(unique instanceof UniqueViolationError).toBe(true);
    expect(unique.constraint).toBe("tables_name_uq");
    expect(new other.TenantContextError("TENANT_CONTEXT_MISSING")).toBeInstanceOf(
      TenantContextError,
    );
    expect(unique instanceof TenantContextError).toBe(false);
    expect(new Error("plain") instanceof UniqueViolationError).toBe(false);
  });
});
