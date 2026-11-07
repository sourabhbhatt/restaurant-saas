import { and, eq, isNull } from "drizzle-orm";

import type { UploadRepository } from "@ros/application/modules/menu/ports";

import type { Executor } from "../client";
import { storedFiles } from "../schema";

export function uploadRepository(db: Executor): UploadRepository {
  return {
    async insert(input) {
      await db.insert(storedFiles).values({
        workspaceId: input.workspaceId,
        key: input.key,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        purpose: input.purpose,
        createdBy: input.createdBy,
      });
    },
    async findByKey(key) {
      const [row] = await db
        .select({
          workspaceId: storedFiles.workspaceId,
          key: storedFiles.key,
          contentType: storedFiles.contentType,
          sizeBytes: storedFiles.sizeBytes,
          purpose: storedFiles.purpose,
        })
        .from(storedFiles)
        .where(and(eq(storedFiles.key, key), isNull(storedFiles.deletedAt)))
        .limit(1);
      return row ?? null;
    },
  };
}
