import {
  createSystemRunner,
  type Executor,
} from "@/infrastructure/database/providers/postgres/client";
import { auditRepository } from "@/infrastructure/database/providers/postgres/repositories/core";
import { menuRepository } from "@/infrastructure/database/providers/postgres/repositories/menu";
import { uploadRepository } from "@/infrastructure/database/providers/postgres/repositories/uploads";

import type { Container } from "../container";
import { tenantRunner } from "./runners";
import { createMenuService } from "../modules/menu/service";
import { createUploadService } from "../modules/menu/uploads";

/** Per-module wiring: binds the menu module's ports to the Postgres adapters. */
export function menuService(c: Container) {
  const build = (e: Executor) => ({
    menu: menuRepository(e),
    audit: auditRepository(e),
  });
  return createMenuService({
    tx: tenantRunner(c, build),
    // System: finds the restaurant owning a category/item id; the access service then authorizes and binds.
    lookup: createSystemRunner(c.db, build),
    clock: c.clock,
    entitlements: c.entitlements,
    access: c.access,
    fileUrl: (key) => c.storage.url(key),
  });
}

export function uploadService(c: Container) {
  return createUploadService({
    tx: tenantRunner(c, (e) => ({
      uploads: uploadRepository(e),
      audit: auditRepository(e),
    })),
    storage: c.storage,
    entitlements: c.entitlements,
    access: c.access,
  });
}
