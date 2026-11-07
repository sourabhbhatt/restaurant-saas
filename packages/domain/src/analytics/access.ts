import { hasPermission, type AccessGrants, type AccessTarget } from "../access/permissions";

/**
 * Whether the grants allow viewing reports for a branch.
 *
 * `reports.view` is a RESTAURANT-scope permission, so `hasPermission` only
 * honours it from the workspace role or a restaurant-wide assignment. A role
 * assigned to a single branch (e.g. a Restaurant Manager for one branch) is
 * meant to grant its reports for that branch, so a branch assignment that
 * carries `reports.view` also counts — for that branch only.
 */
export function canViewBranchReports(
  grants: AccessGrants,
  target: Required<Pick<AccessTarget, "restaurantId" | "branchId">>,
): boolean {
  if (hasPermission(grants, "reports.view", target)) return true;
  return grants.branches.get(target.branchId)?.has("reports.view") ?? false;
}
