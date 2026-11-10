"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ChefHatIcon, QrCodeIcon, ReceiptTextIcon, ShieldCheckIcon } from "lucide-react";

import { BRAND, LEGAL_NAV } from "../site/brand";
import { BrandLogo } from "../site/logo";
import { appHref, useAppLinks } from "../../app-links";

const POINTS = [
  { icon: QrCodeIcon, text: "Guests order by QR — no app, no account" },
  { icon: ShieldCheckIcon, text: "Waiters approve every order" },
  { icon: ChefHatIcon, text: "Live kitchen display with delay alerts" },
  { icon: ReceiptTextIcon, text: "Counter billing with split payments" },
];

/** Split-screen auth layout: brand panel (lg+) beside the form; single column on mobile. */
export function AuthShell({ children }: { children: ReactNode }) {
  const links = useAppLinks();
  return (
    <div className="grid min-h-dvh flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_0%_0%,color-mix(in_oklch,white_20%,transparent),transparent),radial-gradient(50%_50%_at_100%_100%,color-mix(in_oklch,black_22%,transparent),transparent)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(color-mix(in_oklch,white_22%,transparent)_1px,transparent_1px)] [mask-image:linear-gradient(to_bottom,black,transparent)] [background-size:22px_22px] opacity-50"
        />
        <BrandLogo
          className="relative"
          markClassName="bg-primary-foreground text-primary shadow-none"
        />
        <div className="relative flex max-w-md flex-col gap-8">
          <p className="text-3xl leading-tight font-semibold tracking-tight text-balance xl:text-4xl">
            Every table, kitchen and counter — in step.
          </p>
          <ul className="flex flex-col gap-4">
            {POINTS.map((p) => (
              <li key={p.text} className="flex items-center gap-3 text-primary-foreground/90">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-foreground/12 ring-1 ring-primary-foreground/20">
                  <p.icon aria-hidden="true" className="size-4" />
                </span>
                {p.text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-primary-foreground/70">{BRAND.tagline}</p>
      </aside>

      <div className="flex flex-col">
        <header className="flex items-center justify-between px-4 py-4 sm:px-8 lg:justify-end">
          <BrandLogo className="lg:hidden" />
          <Link
            href={appHref(links.console, "/")}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Back to website
          </Link>
        </header>
        <main id="main" className="flex flex-1 items-center justify-center px-4 py-8 sm:px-8">
          <div className="w-full max-w-md motion-safe:animate-in motion-safe:duration-500 motion-safe:fade-in motion-safe:slide-in-from-bottom-2">
            {children}
          </div>
        </main>
        <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-6 text-xs text-muted-foreground">
          {LEGAL_NAV.map((l) => (
            <Link
              key={l.href}
              href={appHref(links.console, l.href)}
              className="hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </footer>
      </div>
    </div>
  );
}
