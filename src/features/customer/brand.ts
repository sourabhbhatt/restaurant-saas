import type { CSSProperties } from "react";

/**
 * Restaurant brand colour → design-token overrides for the customer wrapper.
 * Only a strict #rrggbb value is accepted; anything else keeps the default
 * theme. The foreground is chosen for contrast (WCAG relative luminance).
 */
const HEX = /^#([0-9a-f]{6})$/i;

function luminance(hex: string): number {
  const n = parseInt(hex, 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

export function brandStyle(brandColor: string | null | undefined): CSSProperties | undefined {
  const match = brandColor ? HEX.exec(brandColor.trim()) : null;
  if (!match) return undefined;
  const hex = match[1]!;
  const color = `#${hex}`;
  // Contrast against white vs near-black; pick the stronger.
  const l = luminance(hex);
  const onWhite = 1.05 / (l + 0.05);
  const onDark = (l + 0.05) / 0.05;
  const foreground = onWhite >= onDark ? "#ffffff" : "#1c1917";
  return {
    "--primary": color,
    "--primary-foreground": foreground,
    "--ring": color,
  } as CSSProperties;
}
