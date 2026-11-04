import type { TenancyServiceDeps } from "./deps";
import { createPeopleService } from "./people-service";
import { createStructureService } from "./structure-service";

export type { TenancyServiceDeps } from "./deps";

/**
 * Tenancy use cases: restaurants, branches and their settings (structure),
 * members, role assignments, invitations and custom roles (people).
 */
export function createTenancyService(deps: TenancyServiceDeps) {
  return { ...createStructureService(deps), ...createPeopleService(deps) };
}

export type TenancyService = ReturnType<typeof createTenancyService>;
