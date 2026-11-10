"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { cacheCurrentPage } from "../cache-current-page";
import { startOfflineRuntime } from "../runtime";

/** Starts the sync engine and query persistence for this tab (client only). */
export function OfflineRuntime() {
  const queryClient = useQueryClient();
  useEffect(() => startOfflineRuntime(queryClient), [queryClient]);
  // So the screen this tab opened on can be reloaded offline.
  useEffect(() => {
    void cacheCurrentPage().catch(() => undefined);
  }, []);
  return null;
}
