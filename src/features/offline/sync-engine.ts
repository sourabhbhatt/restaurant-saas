import type { OfflineDatabase, OutboxItem, OutboxMethod } from "./db";

/**
 * Outbox sync engine. Sends locally queued mutations to the API in order,
 * with idempotency keys, exponential backoff, conflict detection and
 * crash recovery. Framework-free and fully injectable (db, fetch, clock,
 * randomness, cross-tab lock) so it can be unit tested.
 *
 * Guarantees:
 * - FIFO per `scopeKey`: an item is never sent before an earlier item of the
 *   same scope has synced. A failed/conflicting head blocks its scope until
 *   the user retries or discards it.
 * - Every attempt of an item carries the same `Idempotency-Key`.
 * - Nothing is ever deleted without an explicit `discard()` (synced items are
 *   pruned after a retention period; they are already on the server).
 * - Items are only sent while their own user is signed in.
 */

export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_MAX_MS = 5 * 60_000;
/** A "syncing" item older than this is assumed interrupted (tab closed/crashed). */
export const STUCK_SYNCING_MS = 60_000;
export const REQUEST_TIMEOUT_MS = 30_000;
export const SYNCED_RETENTION_MS = 24 * 60 * 60_000;
export const SYNCED_KEEP = 50;

const CONFLICT_CODES = new Set(["STALE_VERSION", "CONFLICT", "INVALID_STATE_TRANSITION"]);

/**
 * Delay before retry number `attempt` (1 = after the first failure):
 * 1s, 2s, 4s, 8s … capped at 5 minutes, with ±20% jitter so many devices
 * reconnecting at once don't retry in lockstep.
 */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1));
  const jitter = 0.8 + 0.4 * random();
  return Math.min(BACKOFF_MAX_MS, Math.round(exp * jitter));
}

export type Outcome = "synced" | "retry" | "conflict" | "failed" | "auth";

/** How an HTTP response (or a network failure, status 0) is handled. */
export function classifyResponse(status: number, code: string | null): Outcome {
  if (status >= 200 && status < 300) return "synced";
  if (status === 0 || status === 408 || status === 429 || status >= 500) return "retry";
  if (status === 401) return "auth";
  if (status === 409 && (!code || CONFLICT_CODES.has(code))) return "conflict";
  return "failed";
}

export interface EnqueueInput {
  kind: string;
  label: string;
  method: OutboxMethod;
  path: string;
  body?: unknown;
  scopeKey: string;
  expectedVersion?: number;
  /** Body field for `expectedVersion` (default `version`, e.g. `expectedVersion` for orders). */
  versionField?: string;
  /** See OutboxItem.chainVersion. Use only when the scope is a single record. */
  chainVersion?: boolean;
  /**
   * Reuse a key the caller already owns (e.g. a draft's body `idempotencyKey`)
   * instead of generating one, so every attempt is the same request.
   */
  idempotencyKey?: string;
  meta?: Record<string, string>;
  /** Query keys to invalidate once this change reached the server. */
  invalidateKeys?: unknown[][];
}

export interface SyncRunResult {
  synced: number;
  retried: number;
  conflicts: number;
  failed: number;
  /** Another tab held the sync lock; it does the work. */
  skipped: boolean;
}

export interface SyncEngineDeps {
  db: OfflineDatabase;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** The user working on this device (owner of new items; may be restored from cache offline). */
  getUserId: () => string | null;
  /**
   * The user the current session cookie belongs to, as confirmed by the server.
   * Only this user's items are sent. Defaults to `getUserId`.
   */
  getSessionUserId?: () => string | null;
  /**
   * Ask the server who the session belongs to, right before sending. A run is
   * skipped unless it matches the session user, so one account's changes can
   * never be sent with another account's cookie on a shared device.
   */
  confirmSession?: () => Promise<string | null>;
  now?: () => number;
  random?: () => number;
  apiBase?: string;
  newId?: () => string;
  newIdempotencyKey?: () => string;
  /** Exclusive cross-tab section. Resolve false when another tab holds it. */
  withLock?: (work: () => Promise<void>) => Promise<boolean>;
  onRunStateChange?: (syncing: boolean) => void;
  onItemSynced?: (item: OutboxItem) => void;
  /** true after any HTTP response, false after a network failure. */
  onConnectivity?: (online: boolean) => void;
  onAuthRequired?: (required: boolean) => void;
}

const randomKey = () => crypto.randomUUID().replace(/-/g, "");

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface RunContext {
  force: boolean;
  stop: boolean;
  result: SyncRunResult;
}

export class SyncEngine {
  private readonly deps: SyncEngineDeps;
  private readonly now: () => number;
  private readonly random: () => number;
  private running: Promise<SyncRunResult> | null = null;
  private rerun = false;
  private rerunForce = false;

  constructor(deps: SyncEngineDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
  }

  get db(): OfflineDatabase {
    return this.deps.db;
  }

  /** Queue a mutation for the signed-in user. Does not send it (call syncNow). */
  async enqueue(input: EnqueueInput): Promise<OutboxItem> {
    const userId = this.deps.getUserId();
    if (!userId) throw new Error("Sign in to save changes on this device.");
    if (!input.path.startsWith("/")) throw new Error("Outbox path must start with /");
    const now = this.now();
    const item: OutboxItem = {
      id: (this.deps.newId ?? (() => crypto.randomUUID()))(),
      createdAt: now,
      updatedAt: now,
      userId,
      scopeKey: input.scopeKey,
      kind: input.kind,
      label: input.label,
      method: input.method,
      path: input.path,
      body: input.body,
      idempotencyKey: input.idempotencyKey ?? (this.deps.newIdempotencyKey ?? randomKey)(),
      expectedVersion: input.expectedVersion,
      versionField: input.versionField,
      chainVersion: input.chainVersion,
      meta: input.meta,
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
      lastError: null,
      lastErrorCode: null,
      lastStatus: null,
      syncedAt: null,
      invalidateKeys: input.invalidateKeys,
    };
    // Keep FIFO stable even when two items are queued in the same millisecond.
    const last = await this.deps.db.outbox.orderBy("createdAt").last();
    if (last && last.createdAt >= item.createdAt) {
      item.createdAt = last.createdAt + 1;
    }
    await this.deps.db.outbox.add(item);
    return item;
  }

  /**
   * Send everything that is due. `force` (manual "Sync now") ignores backoff
   * timers. Concurrent calls share one run (and schedule one more pass).
   */
  syncNow(options: { force?: boolean } = {}): Promise<SyncRunResult> {
    const force = options.force ?? false;
    if (this.running) {
      this.rerun = true;
      this.rerunForce ||= force;
      return this.running;
    }
    this.running = this.runLoop(force).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  get isRunning(): boolean {
    return this.running !== null;
  }

  private async runLoop(initialForce: boolean): Promise<SyncRunResult> {
    const result: SyncRunResult = {
      synced: 0,
      retried: 0,
      conflicts: 0,
      failed: 0,
      skipped: false,
    };
    let force = initialForce;
    this.deps.onRunStateChange?.(true);
    try {
      do {
        this.rerun = false;
        const ctx: RunContext = { force, stop: false, result };
        const work = () => this.runOnce(ctx);
        const ran = this.deps.withLock ? await this.deps.withLock(work) : (await work(), true);
        if (!ran) result.skipped = true;
        force = this.rerunForce;
        this.rerunForce = false;
      } while (this.rerun);
    } finally {
      this.deps.onRunStateChange?.(false);
    }
    return result;
  }

  private async runOnce(ctx: RunContext): Promise<void> {
    const userId = (this.deps.getSessionUserId ?? this.deps.getUserId)();
    if (!userId) return;
    await this.recoverStuck();
    const items = await this.deps.db.outbox
      .where("userId")
      .equals(userId)
      .filter((i) => i.status !== "synced")
      .sortBy("createdAt");
    const now = this.now();
    const anyDue = items.some(
      (i) => i.status === "pending" && (ctx.force || i.nextAttemptAt <= now),
    );
    if (!anyDue) {
      await this.prune();
      return;
    }
    if (this.deps.confirmSession) {
      const confirmed = await this.deps.confirmSession().catch(() => null);
      if (confirmed !== userId) return;
    }
    const scopes = new Map<string, OutboxItem[]>();
    for (const item of items) {
      const queue = scopes.get(item.scopeKey) ?? [];
      queue.push(item);
      scopes.set(item.scopeKey, queue);
    }
    await Promise.all([...scopes.values()].map((queue) => this.drainScope(queue, userId, ctx)));
    await this.prune();
  }

  private async drainScope(queue: OutboxItem[], userId: string, ctx: RunContext): Promise<void> {
    for (const item of queue) {
      if (ctx.stop) return;
      // Strict FIFO: anything not yet synced at the head blocks the rest of the scope.
      if (item.status !== "pending") return;
      if (!ctx.force && item.nextAttemptAt > this.now()) return;
      const outcome = await this.send(item, userId, ctx);
      if (outcome !== "synced") return;
    }
  }

  private buildBody(item: OutboxItem): unknown {
    if (item.expectedVersion === undefined) return item.body;
    const field = item.versionField ?? "version";
    if (item.body === undefined) return { [field]: item.expectedVersion };
    if (isPlainObject(item.body)) return { ...item.body, [field]: item.expectedVersion };
    return item.body;
  }

  /**
   * After a chained item synced: later pending items of the scope that were
   * made on the same version the server just accepted now build on the
   * version it returned.
   */
  private async rebaseScope(item: OutboxItem, data: unknown): Promise<void> {
    if (!item.chainVersion || item.expectedVersion === undefined) return;
    if (!isPlainObject(data) || typeof data.version !== "number") return;
    const base = item.expectedVersion;
    const next = data.version;
    await this.deps.db.outbox
      .where("scopeKey")
      .equals(item.scopeKey)
      .filter(
        (i) =>
          i.id !== item.id &&
          i.userId === item.userId &&
          i.status === "pending" &&
          i.chainVersion === true &&
          i.expectedVersion === base &&
          i.createdAt > item.createdAt,
      )
      .modify({ expectedVersion: next });
  }

  private async send(
    item: OutboxItem,
    userId: string,
    ctx: RunContext,
  ): Promise<Outcome | "skipped"> {
    const { db } = this.deps;
    // Atomic claim: only one tab/run can move an item from pending to syncing.
    const claimed = await db.transaction("rw", db.outbox, async () => {
      const fresh = await db.outbox.get(item.id);
      if (!fresh || fresh.status !== "pending" || fresh.userId !== userId) return null;
      const next: OutboxItem = {
        ...fresh,
        status: "syncing",
        attempts: fresh.attempts + 1,
        updatedAt: this.now(),
      };
      await db.outbox.put(next);
      return next;
    });
    if (!claimed) return "skipped";

    const base = this.deps.apiBase ?? "/api/v1";
    const url = claimed.path.startsWith("/api/") ? claimed.path : `${base}${claimed.path}`;
    const body = this.buildBody(claimed);
    const headers: Record<string, string> = {
      accept: "application/json",
      "idempotency-key": claimed.idempotencyKey,
    };
    if (body !== undefined) headers["content-type"] = "application/json";

    let status = 0;
    let payload: unknown = null;
    let retryAfterMs = 0;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
      const res = await this.deps.fetch(url, {
        method: claimed.method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: "same-origin",
        cache: "no-store",
        signal: controller?.signal,
      });
      status = res.status;
      const text = await res.text().catch(() => "");
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      if (Number.isFinite(retryAfter) && retryAfter > 0) retryAfterMs = retryAfter * 1000;
    } catch {
      status = 0;
    } finally {
      if (timer) clearTimeout(timer);
    }

    this.deps.onConnectivity?.(status !== 0);
    const error = isPlainObject(payload) && isPlainObject(payload.error) ? payload.error : null;
    const code = typeof error?.code === "string" ? error.code : null;
    const message =
      typeof error?.message === "string"
        ? error.message
        : status === 0
          ? "No connection to the server"
          : `Request failed (${status})`;
    const outcome = classifyResponse(status, code);
    const now = this.now();

    switch (outcome) {
      case "synced": {
        const data = isPlainObject(payload) ? payload.data : undefined;
        await db.transaction("rw", db.outbox, async () => {
          await db.outbox.update(claimed.id, {
            status: "synced",
            updatedAt: now,
            syncedAt: now,
            lastError: null,
            lastErrorCode: null,
            lastStatus: status,
            serverResponse: data,
          });
          await this.rebaseScope(claimed, data);
        });
        ctx.result.synced += 1;
        this.deps.onAuthRequired?.(false);
        this.deps.onItemSynced?.({ ...claimed, status: "synced", syncedAt: now });
        break;
      }
      case "retry":
      case "auth":
        await db.outbox.update(claimed.id, {
          status: "pending",
          updatedAt: now,
          nextAttemptAt: now + Math.max(backoffDelay(claimed.attempts, this.random), retryAfterMs),
          lastError: outcome === "auth" ? "Sign in again to sync this change" : message,
          lastErrorCode: code ?? (status === 0 ? "NETWORK_ERROR" : null),
          lastStatus: status,
        });
        ctx.result.retried += 1;
        // Offline or signed out: no point trying the other scopes in this run.
        if (status === 0 || outcome === "auth") ctx.stop = true;
        if (outcome === "auth") this.deps.onAuthRequired?.(true);
        break;
      case "conflict":
      case "failed":
        await db.outbox.update(claimed.id, {
          status: outcome,
          updatedAt: now,
          lastError: message,
          lastErrorCode: code,
          lastStatus: status,
          serverResponse: error ?? undefined,
        });
        if (outcome === "conflict") ctx.result.conflicts += 1;
        else ctx.result.failed += 1;
        break;
    }
    return outcome;
  }

  /** Reset items left in "syncing" by a closed/crashed tab so they are retried. */
  async recoverStuck(): Promise<number> {
    const cutoff = this.now() - STUCK_SYNCING_MS;
    return this.deps.db.outbox
      .where("status")
      .equals("syncing")
      .filter((i) => i.updatedAt < cutoff)
      .modify({ status: "pending", nextAttemptAt: this.now() });
  }

  /** Synced items are already on the server; keep a short history for the UI. */
  async prune(): Promise<void> {
    const { db } = this.deps;
    const cutoff = this.now() - SYNCED_RETENTION_MS;
    await db.outbox
      .where("status")
      .equals("synced")
      .filter((i) => (i.syncedAt ?? i.updatedAt) < cutoff)
      .delete();
    const synced = await db.outbox.where("status").equals("synced").sortBy("updatedAt");
    const excess = synced.length - SYNCED_KEEP;
    if (excess > 0) await db.outbox.bulkDelete(synced.slice(0, excess).map((i) => i.id));
  }

  /** User action: try a failed/conflicting (or waiting) item again now, unchanged. */
  async retry(id: string): Promise<boolean> {
    const userId = this.deps.getUserId();
    const changed = await this.deps.db.outbox
      .where("id")
      .equals(id)
      .filter(
        (i) =>
          i.userId === userId &&
          (i.status === "failed" || i.status === "conflict" || i.status === "pending"),
      )
      .modify({ status: "pending", nextAttemptAt: this.now(), updatedAt: this.now() });
    return changed > 0;
  }

  /**
   * User action on a conflict: re-apply this change on top of the latest
   * server state. The version check is dropped, except for chained records
   * (orders), whose API requires one: those are resent against the version
   * the conflict reported. A new idempotency key is used because the request
   * differs from the one that conflicted.
   */
  async retryWithLatest(id: string): Promise<boolean> {
    const userId = this.deps.getUserId();
    const { db } = this.deps;
    return db.transaction("rw", db.outbox, async () => {
      const item = await db.outbox.get(id);
      if (!item || item.userId !== userId || item.status !== "conflict") return false;
      const field = item.versionField ?? "version";
      let body = item.body;
      if (isPlainObject(body) && field in body) {
        const { [field]: _version, ...rest } = body;
        body = rest;
      }
      const details = isPlainObject(item.serverResponse) ? item.serverResponse.details : null;
      const latest =
        item.chainVersion && isPlainObject(details) && typeof details.version === "number"
          ? details.version
          : undefined;
      await db.outbox.put({
        ...item,
        body,
        expectedVersion: latest,
        idempotencyKey: (this.deps.newIdempotencyKey ?? randomKey)(),
        status: "pending",
        nextAttemptAt: this.now(),
        updatedAt: this.now(),
      });
      return true;
    });
  }

  /** User action: permanently drop a local change (never called automatically). */
  async discard(id: string): Promise<boolean> {
    const userId = this.deps.getUserId();
    const { db } = this.deps;
    return db.transaction("rw", db.outbox, async () => {
      const item = await db.outbox.get(id);
      if (!item || item.userId !== userId || item.status === "syncing") return false;
      await db.outbox.delete(id);
      return true;
    });
  }

  /** User action: drop unsynced changes another account left on this device. */
  async discardOtherUsers(): Promise<number> {
    const userId = this.deps.getUserId();
    if (!userId) return 0;
    return this.deps.db.outbox.filter((i) => i.userId !== userId).delete();
  }

  /** User action: hide the "recently synced" history. */
  async clearSynced(): Promise<number> {
    const userId = this.deps.getUserId();
    return this.deps.db.outbox
      .where("status")
      .equals("synced")
      .filter((i) => i.userId === userId)
      .delete();
  }

  async listForUser(userId: string): Promise<OutboxItem[]> {
    return this.deps.db.outbox.where("userId").equals(userId).sortBy("createdAt");
  }

  /** Earliest time a pending item becomes due (for scheduling a wake-up). */
  async nextDueAt(): Promise<number | null> {
    const userId = this.deps.getUserId();
    if (!userId) return null;
    const pending = await this.deps.db.outbox
      .where("[userId+status]")
      .equals([userId, "pending"])
      .toArray();
    if (pending.length === 0) return null;
    return Math.min(...pending.map((i) => i.nextAttemptAt));
  }
}
