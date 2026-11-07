import {
  MAX_UPLOAD_BYTES,
  UPLOAD_PURPOSES,
  type UploadPurpose,
  type UploadResultDto,
} from "@/contracts/menu";
import type { Permission } from "@/domain/access/permissions";
import { additionalStorageMb, sniffImage } from "@/domain/menu/image-sniff";
import { DomainError, forbidden, validationFailed } from "@/domain/shared/errors";
import type { TransactionRunner } from "@/infrastructure/database/interfaces/transaction";
import type { ObjectStorage } from "@/infrastructure/storage/interfaces/object-storage";

import { recordAudit } from "../../audit/audit-service";
import type { AccessService, WorkspaceScope } from "../../authz/access-service";
import { auditActorFor, type RequestMeta, type UserActor } from "../../context";
import { TenantContextError } from "../../db-context";
import type { EntitlementService } from "../../subscriptions/entitlement-service";
import type { UploadRepos } from "./ports";

/**
 * Image uploads (menu items, logos, covers).
 *
 * Security model: object keys are `ws/<workspaceId>/<purpose>/<random uuid>.<ext>`
 * and are unguessable; files are public-by-key (served by GET /files/<key>
 * without authentication, like a CDN), so only non-sensitive images are
 * accepted. The type is sniffed from magic bytes (PNG/JPEG/WebP; SVG is
 * rejected) and served with `nosniff`.
 */
export interface UploadServiceDeps {
  tx: TransactionRunner<UploadRepos>;
  storage: ObjectStorage;
  entitlements: EntitlementService;
  access: AccessService;
  randomId?: () => string;
}

export interface UploadInput {
  file: FormDataEntryValue | null;
  purpose: string | null;
  restaurantId: string | null;
}

const REQUIRED: Record<UploadPurpose, readonly Permission[]> = {
  menu_item: ["menu.manage"],
  logo: ["restaurant.update"],
  cover: ["restaurant.update"],
};

function isPurpose(v: string | null): v is UploadPurpose {
  return v !== null && (UPLOAD_PURPOSES as readonly string[]).includes(v);
}

export function createUploadService(deps: UploadServiceDeps) {
  const { tx, storage, entitlements, access } = deps;
  const randomId = deps.randomId ?? (() => crypto.randomUUID());

  /**
   * Permission: with `restaurantId`, the purpose's permission on that restaurant
   * (menu.manage for menu images, restaurant.update for logo/cover). Without it,
   * that permission on at least one restaurant of the workspace.
   */
  async function authorize(
    actor: UserActor,
    scope: WorkspaceScope,
    purpose: UploadPurpose,
    restaurantId: string | null,
  ) {
    const perms = REQUIRED[purpose];
    if (restaurantId) {
      const rs = await access.forRestaurant(actor, restaurantId).catch((error: unknown) => {
        // A restaurant of another workspace the actor also belongs to conflicts with this request's workspace.
        if (
          (error instanceof DomainError && error.code === "NOT_FOUND") ||
          error instanceof TenantContextError
        ) {
          throw validationFailed("Choose a restaurant", { restaurantId: ["Unknown restaurant"] });
        }
        throw error;
      });
      if (rs.workspaceId !== scope.workspaceId) {
        throw validationFailed("Choose a restaurant", { restaurantId: ["Unknown restaurant"] });
      }
      const p = perms.find((x) => rs.can(x)) ?? perms[0]!;
      rs.require(p);
      return;
    }
    for (const p of perms) {
      if (scope.can(p)) return scope.require(p);
      for (const rid of scope.grants.restaurants.keys()) {
        if (scope.can(p, { restaurantId: rid })) return scope.require(p, { restaurantId: rid });
      }
    }
    throw forbidden();
  }

  return {
    async upload(
      actor: UserActor,
      workspaceId: string,
      input: UploadInput,
      meta: RequestMeta,
    ): Promise<UploadResultDto> {
      const scope = await access.forWorkspace(actor, workspaceId);
      if (!isPurpose(input.purpose)) {
        throw validationFailed("Choose what the image is for", {
          purpose: ["Must be one of menu_item, logo, cover"],
        });
      }
      await authorize(actor, scope, input.purpose, input.restaurantId);

      const file = input.file;
      if (!file || typeof file === "string" || file.size === 0) {
        throw validationFailed("Choose an image to upload", { file: ["Choose an image"] });
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        throw validationFailed("Images must be 2 MB or smaller", {
          file: ["Images must be 2 MB or smaller"],
        });
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength > MAX_UPLOAD_BYTES) {
        throw validationFailed("Images must be 2 MB or smaller", {
          file: ["Images must be 2 MB or smaller"],
        });
      }
      const kind = sniffImage(bytes);
      if (!kind) {
        throw validationFailed("Upload a PNG, JPEG or WebP image", {
          file: ["Upload a PNG, JPEG or WebP image"],
        });
      }

      const usage = await entitlements.getUsage(scope.workspaceId);
      await entitlements.assertCanAdd(
        scope.workspaceId,
        "storageMb",
        additionalStorageMb(usage.storageBytes, bytes.byteLength),
      );

      const key = `ws/${scope.workspaceId}/${input.purpose}/${randomId()}.${kind.ext}`;
      await storage.put({ key, body: bytes, contentType: kind.contentType });
      try {
        await tx.run(async (r) => {
          await r.uploads.insert({
            workspaceId: scope.workspaceId,
            key,
            contentType: kind.contentType,
            sizeBytes: bytes.byteLength,
            purpose: input.purpose!,
            createdBy: actor.userId,
          });
          await recordAudit(
            r.audit,
            auditActorFor(actor, meta),
            "file.uploaded",
            { workspaceId: scope.workspaceId, targetType: "stored_file", targetId: key },
            {
              purpose: input.purpose,
              sizeBytes: bytes.byteLength,
              contentType: kind.contentType,
              restaurantId: input.restaurantId,
            },
          );
        });
      } catch (error) {
        await storage.delete(key).catch(() => {});
        throw error;
      }
      return { key, url: storage.url(key) };
    },

    /** Public read by key (unguessable). Returns null when missing. */
    async read(key: string) {
      if (!/^ws\/[0-9a-f-]{36}\/[a-z_]+\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(key)) return null;
      return storage.get(key);
    },
  };
}

export type UploadService = ReturnType<typeof createUploadService>;
