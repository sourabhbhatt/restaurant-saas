import type { z } from "zod";

import type {
  BranchDto,
  BranchSettingsDto,
  branchSettingsSchema,
  createBranchSchema,
  createRestaurantSchema,
  RestaurantDetailDto,
  RestaurantDto,
  RestaurantListItemDto,
  updateBranchSchema,
  updateRestaurantSchema,
} from "@/contracts/tenancy";
import { defaultBusinessHours } from "@/contracts/tenancy";
import { effectivePermissions } from "@/domain/access/permissions";
import { validateTaxConfig } from "@/domain/billing/bill-calculator";
import { conflict, DomainError, notFound, validationFailed } from "@/domain/shared/errors";
import { UniqueViolationError } from "@/infrastructure/database/interfaces/transaction";

import { recordAudit } from "../../audit/audit-service";
import type { BranchScope, RestaurantScope, WorkspaceScope } from "../../authz/access-service";
import { auditActorFor, type RequestMeta } from "../../context";
import { slugify } from "../workspaces/service";
import type { TenancyServiceDeps } from "./deps";
import type { BranchPatch, RestaurantPatch, TenancyRepos } from "./ports";
import { baseBranchCode, nextFreeBranchCode } from "./rules";

type CreateRestaurant = z.output<typeof createRestaurantSchema>;
type UpdateRestaurant = z.output<typeof updateRestaurantSchema>;
type CreateBranch = z.output<typeof createBranchSchema>;
type UpdateBranch = z.output<typeof updateBranchSchema>;
type BranchSettingsInput = z.output<typeof branchSettingsSchema>;

const stale = (what: string) =>
  new DomainError(
    "STALE_VERSION",
    `This ${what} was changed by someone else. Reload and try again.`,
  );

const codeTaken = () =>
  new DomainError("CONFLICT", "Another branch of this restaurant already uses this code", {
    fieldErrors: { code: ["This code is already used by another branch"] },
  });

/** Logo and cover keys must be this workspace's uploads, not another tenant's. */
function assertOwnImageKeys(workspaceId: string, input: Partial<CreateRestaurant>): void {
  for (const field of ["logoKey", "coverKey"] as const) {
    const key = input[field];
    if (key && !key.startsWith(`ws/${workspaceId}/`)) {
      throw validationFailed("Upload the image again", { [field]: ["Upload the image again"] });
    }
  }
}

function restaurantPatch(input: Partial<CreateRestaurant>): RestaurantPatch {
  const patch: RestaurantPatch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.cuisineTypes !== undefined) patch.cuisineTypes = input.cuisineTypes;
  if (input.logoKey !== undefined) patch.logoKey = input.logoKey;
  if (input.coverKey !== undefined) patch.coverKey = input.coverKey;
  if (input.contactEmail !== undefined) patch.contactEmail = input.contactEmail;
  if (input.contactPhone !== undefined) patch.contactPhone = input.contactPhone;
  if (input.website !== undefined) patch.website = input.website;
  if (input.brandColor !== undefined) patch.brandColor = input.brandColor;
  return patch;
}

function branchPatch(input: UpdateBranch): BranchPatch {
  const patch: BranchPatch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.code !== undefined) patch.code = input.code;
  if (input.addressLine1 !== undefined) patch.addressLine1 = input.addressLine1;
  if (input.addressLine2 !== undefined) patch.addressLine2 = input.addressLine2;
  if (input.city !== undefined) patch.city = input.city;
  if (input.state !== undefined) patch.state = input.state;
  if (input.postalCode !== undefined) patch.postalCode = input.postalCode;
  if (input.country !== undefined) patch.country = input.country;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.email !== undefined) patch.email = input.email;
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  if (input.currency !== undefined) patch.currency = input.currency;
  if (input.businessHours !== undefined)
    patch.businessHours = input.businessHours as BranchPatch["businessHours"];
  return patch;
}

function isCodeViolation(error: unknown): boolean {
  return (
    error instanceof UniqueViolationError && error.constraint === "branches_restaurant_code_uq"
  );
}

export function createStructureService({ tx, clock, entitlements }: TenancyServiceDeps) {
  async function uniqueRestaurantSlug(r: TenancyRepos, workspaceId: string, name: string) {
    const base = slugify(name) || "restaurant";
    let slug = base;
    for (let i = 0; await r.tenancy.restaurantSlugExists(workspaceId, slug); i++) {
      if (i > 20) throw conflict("Could not allocate a restaurant URL; try another name");
      slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    }
    return slug;
  }

  async function getRestaurant(scope: RestaurantScope): Promise<RestaurantDetailDto> {
    // The access scope already guarantees the restaurant is visible to this member
    // (workspace-wide role or an assignment in it); branch-only staff see their branches.
    if (!scope.can("restaurant.view")) scope.require("workspace.view");
    return tx.read(async (r) => {
      const restaurant = await r.tenancy.findRestaurant(scope.workspaceId, scope.restaurantId);
      if (!restaurant) throw notFound("Restaurant");
      const [settings, branches] = await Promise.all([
        r.tenancy.getRestaurantSettings(scope.workspaceId, scope.restaurantId),
        r.tenancy.listBranches(scope.workspaceId, scope.restaurantId),
      ]);
      return {
        ...restaurant,
        settings,
        branches: branches.filter((b) => scope.can("branch.view", { branchId: b.id })),
        permissions: effectivePermissions(scope.grants, { restaurantId: scope.restaurantId }),
      };
    });
  }

  return {
    // ---------------------------------------------------------------- restaurants
    async listRestaurants(scope: WorkspaceScope): Promise<RestaurantListItemDto[]> {
      scope.require("workspace.view");
      return tx.read(async (r) => {
        const list = await r.tenancy.listRestaurants(
          scope.workspaceId,
          scope.visibleRestaurantIds(),
        );
        const branches = await r.tenancy.listBranchSummaries(
          scope.workspaceId,
          list.map((x) => x.id),
        );
        const filter = scope.branchFilter();
        return list.map((restaurant) => ({
          ...restaurant,
          branches: branches
            .filter(
              (b) =>
                b.restaurantId === restaurant.id &&
                (!filter ||
                  filter.restaurantIds.includes(restaurant.id) ||
                  filter.branchIds.includes(b.id)),
            )
            .map(({ restaurantId: _r, ...b }) => b),
        }));
      });
    },

    async createRestaurant(
      scope: WorkspaceScope,
      input: CreateRestaurant,
      meta: RequestMeta,
    ): Promise<RestaurantDto> {
      scope.require("restaurant.create");
      assertOwnImageKeys(scope.workspaceId, input);
      await entitlements.assertCanAdd(scope.workspaceId, "maxRestaurants");
      return tx.run(async (r) => {
        const slug = await uniqueRestaurantSlug(r, scope.workspaceId, input.name);
        const restaurant = await r.tenancy.insertRestaurant(scope.workspaceId, {
          name: input.name,
          slug,
          description: input.description ?? null,
          cuisineTypes: input.cuisineTypes ?? [],
          logoKey: input.logoKey ?? null,
          coverKey: input.coverKey ?? null,
          contactEmail: input.contactEmail ?? null,
          contactPhone: input.contactPhone ?? null,
          website: input.website ?? null,
          brandColor: input.brandColor ?? null,
        });
        await recordAudit(r.audit, auditActorFor(scope.actor, meta), "restaurant.created", {
          workspaceId: scope.workspaceId,
          targetType: "restaurant",
          targetId: restaurant.id,
        });
        return restaurant;
      });
    },

    getRestaurant,

    async updateRestaurant(
      scope: RestaurantScope,
      input: UpdateRestaurant,
      meta: RequestMeta,
    ): Promise<RestaurantDetailDto> {
      scope.require("restaurant.update");
      assertOwnImageKeys(scope.workspaceId, input);
      const patch = restaurantPatch(input);
      await tx.run(async (r) => {
        const updated = await r.tenancy.updateRestaurant(
          scope.workspaceId,
          scope.restaurantId,
          patch,
          input.version,
        );
        if (!updated) {
          const exists = await r.tenancy.findRestaurant(scope.workspaceId, scope.restaurantId);
          if (!exists) throw notFound("Restaurant");
          throw stale("restaurant");
        }
        if (input.settings) {
          const s = input.settings;
          await r.tenancy.updateRestaurantSettings(scope.workspaceId, scope.restaurantId, {
            ...(s.showPrepTime !== undefined ? { showPrepTime: s.showPrepTime } : {}),
            ...(s.showAllergens !== undefined ? { showAllergens: s.showAllergens } : {}),
            ...(s.welcomeMessage !== undefined ? { welcomeMessage: s.welcomeMessage } : {}),
          });
        }
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "restaurant.updated",
          {
            workspaceId: scope.workspaceId,
            targetType: "restaurant",
            targetId: scope.restaurantId,
          },
          {
            fields: Object.keys(patch),
            settings: input.settings ? Object.keys(input.settings) : [],
          },
        );
      });
      return getRestaurant(scope);
    },

    async archiveRestaurant(scope: RestaurantScope, meta: RequestMeta): Promise<void> {
      scope.require("restaurant.delete");
      await tx.run(async (r) => {
        const open = await r.tenancy.countOpenSessions(scope.workspaceId, {
          restaurantId: scope.restaurantId,
        });
        if (open > 0) {
          throw conflict(
            `Close the ${open} open table session${open === 1 ? "" : "s"} before archiving this restaurant`,
          );
        }
        const ok = await r.tenancy.archiveRestaurant(
          scope.workspaceId,
          scope.restaurantId,
          clock.now(),
        );
        if (!ok) throw notFound("Restaurant");
        await recordAudit(r.audit, auditActorFor(scope.actor, meta), "restaurant.archived", {
          workspaceId: scope.workspaceId,
          targetType: "restaurant",
          targetId: scope.restaurantId,
        });
      });
    },

    // ---------------------------------------------------------------- branches
    async listBranches(scope: RestaurantScope): Promise<BranchDto[]> {
      if (!scope.can("restaurant.view")) scope.require("workspace.view");
      const list = await tx.read((r) =>
        r.tenancy.listBranches(scope.workspaceId, scope.restaurantId),
      );
      return list.filter((b) => scope.can("branch.view", { branchId: b.id }));
    },

    async createBranch(
      scope: RestaurantScope,
      input: CreateBranch,
      meta: RequestMeta,
    ): Promise<BranchDto> {
      scope.require("branch.create");
      await entitlements.assertCanAdd(scope.workspaceId, "maxBranches");
      const existing = await tx.read((r) =>
        r.tenancy.countBranches(scope.workspaceId, scope.restaurantId),
      );
      if (existing >= 1) await entitlements.assertFeature(scope.workspaceId, "multi_branch");
      try {
        return await tx.run(async (r) => {
          const ws = await r.tenancy.findWorkspace(scope.workspaceId);
          if (!ws) throw notFound("Workspace");
          const taken = await r.tenancy.listBranchCodes(scope.workspaceId, scope.restaurantId);
          let code: string;
          if (input.code) {
            if (taken.some((c) => c.toUpperCase() === input.code)) throw codeTaken();
            code = input.code;
          } else {
            code = nextFreeBranchCode(baseBranchCode(input.name), taken);
          }
          const branch = await r.tenancy.insertBranch(scope.workspaceId, scope.restaurantId, {
            name: input.name,
            code,
            addressLine1: input.addressLine1 ?? null,
            addressLine2: input.addressLine2 ?? null,
            city: input.city ?? null,
            state: input.state ?? null,
            postalCode: input.postalCode ?? null,
            country: input.country ?? ws.country,
            phone: input.phone ?? null,
            email: input.email ?? null,
            timezone: input.timezone ?? "Asia/Kolkata",
            currency: input.currency ?? ws.defaultCurrency,
            businessHours:
              (input.businessHours as BranchDto["businessHours"] | undefined) ??
              defaultBusinessHours(),
          });
          await recordAudit(
            r.audit,
            auditActorFor(scope.actor, meta),
            "branch.created",
            {
              workspaceId: scope.workspaceId,
              branchId: branch.id,
              targetType: "branch",
              targetId: branch.id,
            },
            { restaurantId: scope.restaurantId, code },
          );
          return branch;
        });
      } catch (error) {
        if (isCodeViolation(error)) throw codeTaken();
        throw error;
      }
    },

    async getBranch(scope: BranchScope): Promise<BranchDto> {
      scope.require("branch.view");
      const branch = await tx.read((r) => r.tenancy.findBranch(scope.workspaceId, scope.branchId));
      if (!branch) throw notFound("Branch");
      return branch;
    },

    async updateBranch(
      scope: BranchScope,
      input: UpdateBranch,
      meta: RequestMeta,
    ): Promise<BranchDto> {
      scope.require("branch.update");
      const patch = branchPatch(input);
      try {
        return await tx.run(async (r) => {
          if (patch.code) {
            const taken = await r.tenancy.listBranchCodes(
              scope.workspaceId,
              scope.restaurantId,
              scope.branchId,
            );
            if (taken.some((c) => c.toUpperCase() === patch.code)) throw codeTaken();
          }
          const updated = await r.tenancy.updateBranch(
            scope.workspaceId,
            scope.branchId,
            patch,
            input.version,
          );
          if (!updated) {
            const exists = await r.tenancy.findBranch(scope.workspaceId, scope.branchId);
            if (!exists) throw notFound("Branch");
            throw stale("branch");
          }
          await recordAudit(
            r.audit,
            auditActorFor(scope.actor, meta),
            "branch.updated",
            {
              workspaceId: scope.workspaceId,
              branchId: scope.branchId,
              targetType: "branch",
              targetId: scope.branchId,
            },
            { fields: Object.keys(patch) },
          );
          return updated;
        });
      } catch (error) {
        if (isCodeViolation(error)) throw codeTaken();
        throw error;
      }
    },

    async archiveBranch(scope: BranchScope, meta: RequestMeta): Promise<void> {
      // Archiving changes the restaurant's structure, so it needs restaurant-level rights.
      scope.require("restaurant.update");
      await tx.run(async (r) => {
        const open = await r.tenancy.countOpenSessions(scope.workspaceId, {
          restaurantId: scope.restaurantId,
          branchId: scope.branchId,
        });
        if (open > 0) {
          throw conflict(
            `Close the ${open} open table session${open === 1 ? "" : "s"} before archiving this branch`,
          );
        }
        const ok = await r.tenancy.archiveBranch(scope.workspaceId, scope.branchId, clock.now());
        if (!ok) throw notFound("Branch");
        await recordAudit(r.audit, auditActorFor(scope.actor, meta), "branch.archived", {
          workspaceId: scope.workspaceId,
          branchId: scope.branchId,
          targetType: "branch",
          targetId: scope.branchId,
        });
      });
    },

    // ---------------------------------------------------------------- branch settings
    async getBranchSettings(scope: BranchScope): Promise<BranchSettingsDto> {
      scope.require("branch.view");
      const settings = await tx.read((r) =>
        r.tenancy.getBranchSettings(scope.workspaceId, scope.branchId),
      );
      if (!settings) throw notFound("Branch");
      return settings;
    },

    async updateBranchSettings(
      scope: BranchScope,
      input: BranchSettingsInput,
      meta: RequestMeta,
    ): Promise<BranchSettingsDto> {
      scope.require("branch.update");
      validateTaxConfig({
        taxes: input.taxes,
        pricesIncludeTax: input.pricesIncludeTax,
        serviceChargeBps: input.serviceChargeBps,
      });
      return tx.run(async (r) => {
        const current = await r.tenancy.getBranchSettings(scope.workspaceId, scope.branchId);
        if (!current) throw notFound("Branch");
        const updated = await r.tenancy.updateBranchSettings(
          scope.workspaceId,
          scope.branchId,
          {
            taxes: input.taxes.map((t) => ({ name: t.name, rateBps: t.rateBps })),
            pricesIncludeTax: input.pricesIncludeTax,
            serviceChargeBps: input.serviceChargeBps,
            paymentMethods: input.paymentMethods,
            requireFullPaymentToClose: input.requireFullPaymentToClose,
            autoCompleteOnPayment: input.autoCompleteOnPayment,
            allowCustomerBillRequest: input.allowCustomerBillRequest,
            acceptingOrders: input.acceptingOrders,
            kitchenDelayMinutes: input.kitchenDelayMinutes,
            kitchenSoundEnabled: input.kitchenSoundEnabled,
            waiterSoundEnabled: input.waiterSoundEnabled,
            receiptHeader: input.receiptHeader ?? null,
            receiptFooter: input.receiptFooter ?? null,
          },
          input.version,
        );
        if (!updated) throw stale("branch's settings");
        await recordAudit(
          r.audit,
          auditActorFor(scope.actor, meta),
          "branch.settings_updated",
          {
            workspaceId: scope.workspaceId,
            branchId: scope.branchId,
            targetType: "branch",
            targetId: scope.branchId,
          },
          {
            taxes: updated.taxes.map((t) => `${t.name}:${t.rateBps}`),
            serviceChargeBps: updated.serviceChargeBps,
            paymentMethods: updated.paymentMethods,
            acceptingOrders: updated.acceptingOrders,
          },
        );
        return updated;
      });
    },
  };
}
