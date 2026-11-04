import Link from "next/link";

import { cn } from "@/lib/utils";

import { BRAND } from "./brand";

/** Brand mark: a plate-and-QR glyph drawn in CSS/SVG so it needs no image request. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-primary text-primary-foreground shadow-sm shadow-primary/30",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-[60%]" fill="none" stroke="currentColor">
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" strokeWidth="2" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" strokeWidth="2" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" strokeWidth="2" />
        <path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 19h1.5M19 14h1.5" strokeWidth="2" />
      </svg>
    </span>
  );
}

export function BrandLogo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2.5 rounded-md text-[1.05rem] font-semibold tracking-tight",
        className,
      )}
    >
      <BrandMark />
      <span>{BRAND.name}</span>
    </Link>
  );
}
