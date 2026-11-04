"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type {
  BillRequestResultDto,
  GuestOrderViewDto,
  GuestSessionDto,
  JoinSessionDto,
  PublicQrDto,
} from "@/contracts/ordering";
import type { PlaceOrderInput } from "@/contracts/orders";
import { api, ApiError } from "@/lib/api-client";

import { customerDb } from "./local-db";

export const customerKeys = {
  qr: (token: string) => ["customer", "qr", token] as const,
  session: (token: string) => ["customer", "session", token] as const,
};

export type QrMenu = PublicQrDto & { offline: boolean; savedAt: number | null };

const isClientError = (e: unknown) =>
  e instanceof ApiError && !e.isNetworkError && e.status >= 400 && e.status < 500;

/**
 * Menu + branding for a QR token. Saved to IndexedDB after every successful
 * load; when the network is unavailable the saved copy is served instead
 * (flagged `offline`) so guests can keep browsing.
 */
export function useQrMenu(token: string) {
  return useQuery({
    queryKey: customerKeys.qr(token),
    queryFn: async ({ signal }): Promise<QrMenu> => {
      try {
        const data = await api.get<PublicQrDto>(
          `/public/qr/${encodeURIComponent(token)}`,
          undefined,
          signal,
        );
        void customerDb.saveMenu(token, data);
        return { ...data, offline: false, savedAt: null };
      } catch (error) {
        if (error instanceof ApiError && error.isNetworkError) {
          const saved = await customerDb.loadMenu(token);
          if (saved) return { ...saved.data, offline: true, savedAt: saved.savedAt };
        }
        if (error instanceof ApiError && error.code === "QR_INVALID") {
          void customerDb.deleteMenu(token);
        }
        throw error;
      }
    },
    staleTime: 60_000,
    retry: (count, error) => !isClientError(error) && count < 2,
  });
}

/** The table session this device joined from this QR (null until the first order). */
export function useJoinedSessionId(token: string): {
  sessionId: string | null;
  loaded: boolean;
  setSessionId: (id: string) => void;
} {
  const [state, setState] = useState<{ sessionId: string | null; loaded: boolean }>({
    sessionId: null,
    loaded: false,
  });
  useEffect(() => {
    let cancelled = false;
    void customerDb.loadJoined(token).then((r) => {
      if (!cancelled) setState({ sessionId: r?.sessionId ?? null, loaded: true });
    });
    return () => {
      cancelled = true;
    };
  }, [token]);
  return {
    ...state,
    setSessionId: (id) => {
      setState({ sessionId: id, loaded: true });
      void customerDb.saveJoined(token, id);
    },
  };
}

/**
 * The guest's own session view. Polls every 5 s while the page is visible
 * (TanStack Query pauses interval refetches for hidden tabs).
 */
export function useGuestSession(token: string, enabled: boolean) {
  return useQuery({
    queryKey: customerKeys.session(token),
    queryFn: ({ signal }) => api.get<GuestSessionDto>("/public/session", undefined, signal),
    enabled,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    staleTime: 2_000,
    retry: (count, error) => !isClientError(error) && count < 2,
  });
}

export interface SubmitOrderInput {
  lines: PlaceOrderInput["lines"];
  specialInstructions?: string;
  idempotencyKey: string;
}

/**
 * Join (or re-join) the table session, then place the order. Joining is
 * idempotent for a device already in the session. The idempotency key is
 * supplied by the cart so retries of one submission can never duplicate it.
 */
export function usePlaceOrder(token: string, onJoined: (sessionId: string) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SubmitOrderInput) => {
      const joined = await api.post<JoinSessionDto>(
        `/public/qr/${encodeURIComponent(token)}/session`,
      );
      onJoined(joined.sessionId);
      return api.post<GuestOrderViewDto>("/public/session/orders", input);
    },
    // Network failures are surfaced to the guest with an explicit Retry instead.
    networkMode: "always",
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: customerKeys.session(token) });
    },
  });
}

export function useRequestBill(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<BillRequestResultDto>("/public/session/bill-request"),
    networkMode: "always",
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: customerKeys.session(token) });
    },
  });
}
