import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";

import { getSiteConfig, type SiteContact } from "./seo/site-config";

/**
 * The support email and legal entity are runtime settings (SITE_SUPPORT_EMAIL,
 * SITE_LEGAL_ENTITY), so one image serves staging and production with their
 * own details. They are read at request time, inside small Suspense holes:
 * the rest of each page stays in the static shell, and a value present at
 * build time can never be baked in. Server components only.
 */

async function ContactValue({ render }: { render: (contact: SiteContact) => ReactNode }) {
  await connection();
  return <>{render(getSiteConfig().contact)}</>;
}

/** Renders `children(contact)` at request time; `fallback` is what the static shell shows. */
export function WithSiteContact({
  fallback,
  children,
}: {
  fallback: ReactNode;
  children: (contact: SiteContact) => ReactNode;
}) {
  return (
    <Suspense fallback={fallback}>
      <ContactValue render={children} />
    </Suspense>
  );
}

export function supportMailto(contact: Pick<SiteContact, "supportEmail">, subject?: string) {
  const query = subject ? `?subject=${encodeURIComponent(subject)}` : "";
  return `mailto:${contact.supportEmail}${query}`;
}

/** The support email as text (legal templates). */
export function SupportEmail() {
  return <WithSiteContact fallback="our support address">{(c) => c.supportEmail}</WithSiteContact>;
}

/** The legal entity as text (legal templates). */
export function LegalEntity() {
  return <WithSiteContact fallback="the operator">{(c) => c.legalEntity}</WithSiteContact>;
}

/** A mailto link showing the support email; the static shell links to the contact page. */
export function SupportEmailLink({ className }: { className?: string }) {
  return (
    <WithSiteContact
      fallback={
        <Link href="/contact" className={className}>
          Contact us
        </Link>
      }
    >
      {(c) => (
        <a href={supportMailto(c)} className={className}>
          {c.supportEmail}
        </a>
      )}
    </WithSiteContact>
  );
}
