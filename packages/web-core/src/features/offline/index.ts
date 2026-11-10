/**
 * Offline layer public API. See docs/offline-sync.md.
 */
export { OfflineBanner } from "./components/offline-banner";
export { NeedsConnectionNote, useIsOffline } from "./components/needs-connection";
export { OfflineDataNotice, type OfflineDataNoticeProps } from "./components/offline-data-notice";
export { OfflineRuntime } from "./components/offline-runtime";
export { PendingChangesSummary } from "./components/pending-changes-summary";
export { SyncStatusIndicator } from "./components/sync-status-indicator";
export type { OutboxItem, OutboxMethod, OutboxStatus } from "./db";
export { shouldPersistQuery } from "./persist-queries";
export {
  kitchenItemStatusMutation,
  kitchenTransitionMutation,
  needsSendConfirmation,
  NEEDS_CONFIRMATION,
  sendConfirmationPrompt,
  STAFF_ORDER_MAX_AGE_MS,
  staffOrderHoldReason,
  orderScope,
  queuedKitchenState,
  queuedStaffOrders,
  scopeHasUnsynced,
  staffOrderMutation,
  tableScope,
  withConfirmedKitchenChanges,
  type KitchenAction,
  type KitchenItemTarget,
  type QueuedKitchenState,
  type StaffOrderDraft,
} from "./queued-ops";
export {
  clearDeviceUserData,
  discardOutboxItem,
  enqueueMutation,
  probeConnectivity,
  retryOutboxItem,
  retryOutboxItemWithLatest,
  syncNow,
  unsentChangesCount,
} from "./runtime";
export type { EnqueueInput } from "./sync-engine";
export { attentionCount, useSyncStore, waitingCount } from "./sync-store";
export { useOfflineDraft, type OfflineDraft } from "./use-offline-draft";
