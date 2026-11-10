import Link from "next/link";

import { BRAND, LEGAL_NAV, SITE_NAV } from "./brand";
import { BrandLogo } from "./logo";

const PRODUCT_LINKS = [
  { href: "/features/qr-code-ordering", label: "QR code ordering" },
  { href: "/features/kitchen-display-system", label: "Kitchen display system" },
  { href: "/features/restaurant-billing", label: "Restaurant billing" },
  { href: "/features/offline-mode", label: "Offline mode" },
];

export function SiteFooter() {
  return (
    <footer className="border-t bg-muted/40">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-3">
          <BrandLogo />
          <p className="max-w-xs text-sm text-muted-foreground">{BRAND.tagline}</p>
          <a
            href={`mailto:${BRAND.supportEmail}`}
            className="w-fit text-sm font-medium text-foreground underline-offset-4 hover:underline"
          >
            {BRAND.supportEmail}
          </a>
        </div>
        <FooterColumn title="Product" links={PRODUCT_LINKS} />
        <FooterColumn title="Company" links={SITE_NAV} />
        <FooterColumn title="Legal" links={LEGAL_NAV} />
      </div>
      <div className="border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            {BRAND.name} — restaurant operations software. Made for restaurants in{" "}
            {BRAND.jurisdiction}.
          </p>
          <p>
            <Link href="/sign-in" className="hover:text-foreground">
              Staff sign in
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: readonly { href: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <ul className="flex flex-col gap-2">
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="text-sm text-muted-foreground hover:text-foreground motion-safe:transition-colors"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
