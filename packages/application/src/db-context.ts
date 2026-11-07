import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { TenantContextError, type DbContext } from "@ros/database/interfaces/transaction";

export { TenantContextError, type DbContext };

/**
 * Request-scoped identity for the database layer. The tenant transaction
 * runner copies it into `app.workspace_id` / `app.user_id`, which the
 * row-level security policies read. The workspace is bound only by the access
 * service after it has verified an ACTIVE membership (or by an explicit
 * token lookup on guest paths), never from client input directly.
 */
const globalForDbContext = globalThis as unknown as {
  __restaurantosDbContext?: AsyncLocalStorage<DbContext>;
};

/**
 * One store per process, held on `globalThis` like the container: Next.js
 * bundles this module separately for the instrumentation hook (which builds
 * the container and its services) and for route handlers, and the two copies
 * must share the same request context.
 */
const storage = (globalForDbContext.__restaurantosDbContext ??= new AsyncLocalStorage<DbContext>());

export function runWithDbContext<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ workspaceId: null, userId: null }, fn);
}

function store(): DbContext {
  const ctx = storage.getStore();
  if (!ctx) throw new TenantContextError("TENANT_CONTEXT_MISSING");
  return ctx;
}

export function bindUser(userId: string): void {
  store().userId = userId;
}

/** One workspace per request: binding a different one is a programming error. */
export function bindWorkspace(workspaceId: string): void {
  const ctx = store();
  if (ctx.workspaceId !== null && ctx.workspaceId !== workspaceId)
    throw new TenantContextError("TENANT_CONTEXT_CONFLICT");
  ctx.workspaceId = workspaceId;
}

/** A snapshot, so callers cannot mutate the bound context. */
export function currentDbContext(): DbContext | null {
  const ctx = storage.getStore();
  return ctx ? { ...ctx } : null;
}
