import type { OperationKind } from "../subscriptions/entitlements";
import type { Permission } from "./permissions";

/**
 * Which subscription access level each permission needs. Checked centrally by
 * the access service together with the permission itself, so no endpoint can
 * forget the subscription check.
 */
const GROW: readonly Permission[] = [
  "restaurant.create",
  "branch.create",
  "workspace.members.manage",
  "workspace.roles.manage",
  "staff.manage",
];

const SETTLE: readonly Permission[] = [
  "payments.record",
  "sessions.manage",
  "bills.generate",
  "workspace.subscription.manage",
  "workspace.support.manage",
];

export function operationKindFor(permission: Permission): OperationKind {
  if (permission.endsWith(".view")) return "read";
  if (GROW.includes(permission)) return "grow";
  if (SETTLE.includes(permission)) return "settle";
  return "operate";
}
