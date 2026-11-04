"use client";

import type * as React from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  CircleCheckIcon,
  InfoIcon,
  LoaderCircleIcon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";

/**
 * App-wide toast host themed with design tokens. Render once near the root and
 * call `toast()` / `toast.success()` from `sonner` anywhere.
 */
function Toaster({ theme = "system", ...props }: ToasterProps) {
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      richColors
      closeButton
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <LoaderCircleIcon className="size-4 motion-safe:animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "color-mix(in oklch, var(--success) 10%, var(--popover))",
          "--success-text": "var(--success)",
          "--success-border": "color-mix(in oklch, var(--success) 30%, var(--popover))",
          "--info-bg": "color-mix(in oklch, var(--info) 10%, var(--popover))",
          "--info-text": "var(--info)",
          "--info-border": "color-mix(in oklch, var(--info) 30%, var(--popover))",
          "--warning-bg": "color-mix(in oklch, var(--warning) 16%, var(--popover))",
          "--warning-text": "var(--foreground)",
          "--warning-border": "color-mix(in oklch, var(--warning) 45%, var(--popover))",
          "--error-bg": "color-mix(in oklch, var(--destructive) 10%, var(--popover))",
          "--error-text": "var(--destructive)",
          "--error-border": "color-mix(in oklch, var(--destructive) 30%, var(--popover))",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
