"use client";

import { useLayoutEffect } from "react";
import { create } from "zustand";

/** Public origins of the three frontends, for cross-app links. */
export interface AppLinks {
  console: string;
  ops: string;
  admin: string;
}

/** Local development ports; production values come from CONSOLE_URL, OPS_URL and ADMIN_URL. */
export const DEFAULT_APP_LINKS: AppLinks = {
  console: "http://localhost:3000",
  ops: "http://localhost:3001",
  admin: "http://localhost:3002",
};

const useAppLinksStore = create<AppLinks>(() => DEFAULT_APP_LINKS);

export function useAppLinks(): AppLinks {
  return useAppLinksStore();
}

/** Absolute URL of a path on another app (or this one). */
export function appHref(origin: string, path: string): string {
  return `${origin.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Rendered by RuntimeAppLinks with the request-time environment. */
export function SetAppLinks({ links }: { links: AppLinks }) {
  useLayoutEffect(() => {
    useAppLinksStore.setState(links);
  }, [links]);
  return null;
}
