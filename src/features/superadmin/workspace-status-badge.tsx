import { StatusBadge } from "@/components/shared/feedback";
import type { WorkspaceStatus } from "@/domain/subscriptions/entitlements";

const TONE = { ACTIVE: "success", SUSPENDED: "danger", DEACTIVATED: "neutral" } as const;
const LABEL = { ACTIVE: "Active", SUSPENDED: "Suspended", DEACTIVATED: "Deactivated" } as const;

export function WorkspaceStatusBadge({ status }: { status: WorkspaceStatus }) {
  return <StatusBadge tone={TONE[status]}>{LABEL[status]}</StatusBadge>;
}
