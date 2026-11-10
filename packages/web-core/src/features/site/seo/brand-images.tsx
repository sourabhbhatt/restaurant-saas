import { BRAND } from "../brand";

/**
 * Artwork for the generated Open Graph image and the Organization logo
 * (rendered with next/og at build time; flexbox-only CSS, default font).
 * Colours are the light-theme brand tokens from globals.css as hex.
 */
const COLORS = {
  primary: "#c24300",
  onPrimary: "#fefdfa",
  background: "#fefdfa",
  foreground: "#2a201b",
  muted: "#7a6a60",
  border: "#eadfd6",
} as const;

/** The site's plate-and-QR brand mark (see logo.tsx), as a standalone SVG. */
function Mark({ size }: { size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        background: COLORS.primary,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg
        width={size * 0.6}
        height={size * 0.6}
        viewBox="0 0 24 24"
        fill="none"
        stroke={COLORS.onPrimary}
        strokeWidth="2"
      >
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
        <path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 19h1.5M19 14h1.5" />
      </svg>
    </div>
  );
}

export function LogoArtwork({ size }: { size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: COLORS.background,
      }}
    >
      <Mark size={size * 0.8} />
    </div>
  );
}

export function OgArtwork() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 80,
        background: COLORS.background,
        color: COLORS.foreground,
        borderBottom: `16px solid ${COLORS.primary}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <Mark size={88} />
        <div style={{ fontSize: 52, letterSpacing: -1 }}>{BRAND.name}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div style={{ fontSize: 64, lineHeight: 1.1, letterSpacing: -1.5, maxWidth: 1000 }}>
          QR table ordering, kitchen display and counter billing for restaurants
        </div>
        <div style={{ fontSize: 30, color: COLORS.muted }}>
          No app for guests · Waiter approves every order · Free trial
        </div>
      </div>
    </div>
  );
}
