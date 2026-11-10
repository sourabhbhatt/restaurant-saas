import { createSystemLookup, type Executor } from "@ros/database/providers/postgres/client";
import {
  auditRepository,
  limitRepository,
} from "@ros/database/providers/postgres/repositories/core";
import { menuRepository } from "@ros/database/providers/postgres/repositories/menu";
import { uploadRepository } from "@ros/database/providers/postgres/repositories/uploads";

import type { Container } from "./container";
import { tenantRunner } from "./runners";
import { createMenuService } from "@ros/application/modules/menu/service";
import { createUploadService } from "@ros/application/modules/menu/uploads";

/** Per-module wiring: binds the menu module's ports to the Postgres adapters. */
export function menuService(c: Container) {
  const build = (e: Executor) => ({
    menu: menuRepository(e),
    audit: auditRepository(e),
    limits: limitRepository(e),
  });
  return createMenuService({
    tx: tenantRunner(c, build),
    // System: finds the restaurant owning a category/item id; the access service then authorizes and binds.
    lookup: createSystemLookup(c.db, menuRepository, ["locateCategory", "locateItem"]),
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
      limits: limitRepository(e),
    })),
    storage: c.storage,
    entitlements: c.entitlements,
    access: c.access,
  });
}
