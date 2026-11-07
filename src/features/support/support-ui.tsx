import { StatusBadge, type StatusTone } from "@/components/shared/feedback";
import {
  SUPPORT_CATEGORY_LABELS,
  type SupportCategory,
  type SupportPriority,
  type SupportStatus,
} from "@ros/contracts/platform";

export const SUPPORT_STATUS_LABEL: Record<SupportStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};
const STATUS_TONE: Record<SupportStatus, StatusTone> = {
  OPEN: "info",
  IN_PROGRESS: "warning",
  RESOLVED: "success",
  CLOSED: "neutral",
};
export const SUPPORT_PRIORITY_LABEL: Record<SupportPriority, string> = {
  LOW: "Low",
  NORMAL: "Normal",
  HIGH: "High",
  URGENT: "Urgent",
};
const PRIORITY_TONE: Record<SupportPriority, StatusTone> = {
  LOW: "neutral",
  NORMAL: "neutral",
  HIGH: "warning",
  URGENT: "danger",
};

export function SupportStatusBadge({ status }: { status: SupportStatus }) {
  return (
    <StatusBadge tone={STATUS_TONE[status]} dot>
      {SUPPORT_STATUS_LABEL[status]}
    </StatusBadge>
  );
}

export function SupportPriorityBadge({ priority }: { priority: SupportPriority }) {
  return (
    <StatusBadge tone={PRIORITY_TONE[priority]}>{SUPPORT_PRIORITY_LABEL[priority]}</StatusBadge>
  );
}

export function categoryLabel(category: SupportCategory): string {
  return SUPPORT_CATEGORY_LABELS[category] ?? category;
}
