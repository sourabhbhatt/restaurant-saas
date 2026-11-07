import {
  bindUser,
  bindWorkspace,
  currentDbContext,
  runWithDbContext,
  TenantContextError,
} from "./db-context";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

describe("db context", () => {
  it("a second copy of the module (another bundle layer) shares the same store", async () => {
    vi.resetModules();
    const other = await import("./db-context");
    expect(other.runWithDbContext).not.toBe(runWithDbContext);
    await runWithDbContext(async () => {
      bindUser("u1");
      other.bindWorkspace(A);
      expect(other.currentDbContext()).toEqual({ workspaceId: A, userId: "u1" });
      expect(currentDbContext()).toEqual({ workspaceId: A, userId: "u1" });
    });
  });

  it("binds and reads within a run", async () => {
    const seen = await runWithDbContext(async () => {
      expect(currentDbContext()).toEqual({ workspaceId: null, userId: null });
      bindUser("u1");
      bindWorkspace(A);
      return currentDbContext();
    });
    expect(seen).toEqual({ workspaceId: A, userId: "u1" });
    expect(currentDbContext()).toBeNull();
  });

  it("contexts do not leak between concurrent runs", async () => {
    const tick = () => new Promise((r) => setTimeout(r, 5));
    const [a, b] = await Promise.all([
      runWithDbContext(async () => {
        bindWorkspace(A);
        await tick();
        return currentDbContext()?.workspaceId;
      }),
      runWithDbContext(async () => {
        await tick();
        bindWorkspace(B);
        await tick();
        return currentDbContext()?.workspaceId;
      }),
    ]);
    expect(a).toBe(A);
    expect(b).toBe(B);
  });

  it("rebinding same workspace is a no-op", async () => {
    await runWithDbContext(async () => {
      bindWorkspace(A);
      expect(() => bindWorkspace(A)).not.toThrow();
      expect(currentDbContext()?.workspaceId).toBe(A);
    });
  });

  it("binding a second workspace throws TENANT_CONTEXT_CONFLICT", async () => {
    await runWithDbContext(async () => {
      bindWorkspace(A);
      let caught: unknown;
      try {
        bindWorkspace(B);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(TenantContextError);
      expect((caught as Error).message).toBe("TENANT_CONTEXT_CONFLICT");
      expect((caught as Error).name).toBe("TenantContextError");
      expect(currentDbContext()?.workspaceId).toBe(A);
    });
  });

  it("binding outside a run throws TENANT_CONTEXT_MISSING", () => {
    expect(() => bindWorkspace(A)).toThrow("TENANT_CONTEXT_MISSING");
    expect(() => bindUser("u1")).toThrow("TENANT_CONTEXT_MISSING");
    expect(currentDbContext()).toBeNull();
  });
});
