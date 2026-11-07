"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { startOfflineRuntime } from "../runtime";

/** Starts the sync engine and query persistence for this tab (client only). */
export function OfflineRuntime() {
  const queryClient = useQueryClient();
  useEffect(() => startOfflineRuntime(queryClient), [queryClient]);
  return null;
}
