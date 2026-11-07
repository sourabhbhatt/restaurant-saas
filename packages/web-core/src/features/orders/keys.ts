/** TanStack Query keys for staff-ops data. Everything for a branch shares the prefix, so a realtime hint invalidates it all. */
export const staffOpsKeys = {
  branch: (branchId: string) => ["staff-ops", branchId] as const,
  orders: (branchId: string, filters: Record<string, string | number | undefined>) =>
    ["staff-ops", branchId, "orders", filters] as const,
  order: (branchId: string, orderId: string) => ["staff-ops", branchId, "order", orderId] as const,
  kitchen: (branchId: string) => ["staff-ops", branchId, "kitchen"] as const,
  sessions: (branchId: string) => ["staff-ops", branchId, "sessions"] as const,
  session: (branchId: string, sessionId: string) =>
    ["staff-ops", branchId, "session", sessionId] as const,
  menu: (branchId: string) => ["staff-ops", branchId, "menu"] as const,
};
