import { createTransactionRunner } from "@/infrastructure/database/providers/postgres/client";
import { auditRepository } from "@/infrastructure/database/providers/postgres/repositories/core";
import { menuRepository } from "@/infrastructure/database/providers/postgres/repositories/menu";
import { uploadRepository } from "@/infrastructure/database/providers/postgres/repositories/uploads";

import type { Container } from "../container";
import { createMenuService } from "../modules/menu/service";
import { createUploadService } from "../modules/menu/uploads";

/** Per-module wiring: binds the menu module's ports to the Postgres adapters. */
export function menuService(c: Container) {
  return createMenuService({
    tx: createTransactionRunner(c.db, (db) => ({
      menu: menuRepository(db),
      audit: auditRepository(db),
    })),
    clock: c.clock,
    entitlements: c.entitlements,
    access: c.access,
    fileUrl: (key) => c.storage.url(key),
  });
}

export function uploadService(c: Container) {
  return createUploadService({
    tx: createTransactionRunner(c.db, (db) => ({
      uploads: uploadRepository(db),
      audit: auditRepository(db),
    })),
    storage: c.storage,
    entitlements: c.entitlements,
    access: c.access,
  });
}
