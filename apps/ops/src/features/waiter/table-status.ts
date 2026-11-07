import type { StatusTone } from "@ros/ui/shared/feedback";
import type { TableStatus } from "@ros/domain/tables/table-status";

export const TABLE_STATUS_META: Record<
  TableStatus,
  { label: string; tone: StatusTone; tile: string }
> = {
  AVAILABLE: {
    label: "Available",
    tone: "success",
    tile: "border-success/40 bg-success/5 hover:bg-success/10",
  },
  OCCUPIED: { label: "Occupied", tone: "info", tile: "border-info/50 bg-info/10 hover:bg-info/15" },
  BILL_REQUESTED: {
    label: "Bill requested",
    tone: "warning",
    tile: "border-warning bg-warning/20 hover:bg-warning/25",
  },
  BILL_GENERATED: {
    label: "Bill generated",
    tone: "neutral",
    tile: "border-primary/50 bg-primary/10 hover:bg-primary/15",
  },
  PAYMENT_PENDING: {
    label: "Payment pending",
    tone: "danger",
    tile: "border-destructive/50 bg-destructive/10 hover:bg-destructive/15",
  },
  CLOSED: {
    label: "Out of service",
    tone: "neutral",
    tile: "border-dashed bg-muted/40 text-muted-foreground hover:bg-muted/60",
  },
};
