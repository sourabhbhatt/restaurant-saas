/**
 * Offline layer public API. See docs/offline-sync.md.
 */
export { OfflineBanner } from "./components/offline-banner";
export { OfflineDataNotice, type OfflineDataNoticeProps } from "./components/offline-data-notice";
export { OfflineRuntime } from "./components/offline-runtime";
export { PendingChangesSummary } from "./components/pending-changes-summary";
export { SyncStatusIndicator } from "./components/sync-status-indicator";
export type { OutboxItem, OutboxMethod, OutboxStatus } from "./db";
export { shouldPersistQuery } from "./persist-queries";
export {
  discardOutboxItem,
  enqueueMutation,
  probeConnectivity,
  retryOutboxItem,
  retryOutboxItemWithLatest,
  syncNow,
} from "./runtime";
export type { EnqueueInput } from "./sync-engine";
export { attentionCount, useSyncStore, waitingCount } from "./sync-store";
export { useOfflineDraft, type OfflineDraft } from "./use-offline-draft";
