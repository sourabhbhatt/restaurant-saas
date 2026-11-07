import { DomainError } from "../shared/errors";

export const UPGRADE_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
export type UpgradeStatus = (typeof UPGRADE_STATUSES)[number];
export type UpgradeAction = "approve" | "reject" | "cancel";

const TARGET: Record<UpgradeAction, UpgradeStatus> = {
  approve: "APPROVED",
  reject: "REJECTED",
  cancel: "CANCELLED",
};

/** Only a PENDING request can be decided; decided requests are final. */
export function nextUpgradeStatus(from: UpgradeStatus, action: UpgradeAction): UpgradeStatus {
  if (from !== "PENDING") {
    throw new DomainError(
      "INVALID_STATE_TRANSITION",
      `This request was already ${from.toLowerCase()}`,
      { details: { from, action } },
    );
  }
  return TARGET[action];
}
