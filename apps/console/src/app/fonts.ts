import localFont from "next/font/local";

/**
 * Geist Mono exactly as `geist/font/mono` defines it, but not preloaded: it is
 * only used for reference codes, branch codes and audit details, so its 70 KB
 * file loads on first use instead of competing with every page's first paint.
 */
export const GeistMono = localFont({
  src: "../../node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  preload: false,
  adjustFontFallback: false,
  fallback: [
    "ui-monospace",
    "SFMono-Regular",
    "Roboto Mono",
    "Menlo",
    "Monaco",
    "Liberation Mono",
    "DejaVu Sans Mono",
    "Courier New",
    "monospace",
  ],
  weight: "100 900",
});
