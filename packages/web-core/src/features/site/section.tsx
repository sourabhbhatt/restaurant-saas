import type { ReactNode } from "react";

import { cn } from "@ros/ui/utils";

import { Breadcrumbs } from "./breadcrumbs";
import type { SitePath } from "./seo/site-pages";

export function Section({
  id,
  children,
  className,
  tone = "default",
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  tone?: "default" | "muted";
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-20 px-4 py-20 sm:px-6 md:py-28",
        tone === "muted" && "border-y bg-muted/40",
        className,
      )}
    >
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </section>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "inline-flex items-center gap-2 text-xs font-semibold tracking-[0.14em] text-primary uppercase",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  as: Heading = "h2",
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  align?: "center" | "left";
  as?: "h1" | "h2";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex max-w-2xl flex-col gap-4",
        align === "center" && "mx-auto items-center text-center",
        className,
      )}
    >
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <Heading
        className={cn(
          "font-semibold tracking-tight text-balance",
          Heading === "h1" ? "text-4xl sm:text-5xl" : "text-3xl sm:text-4xl",
        )}
      >
        {title}
      </Heading>
      {description && (
        <p className="text-base text-pretty text-muted-foreground sm:text-lg">{description}</p>
      )}
    </div>
  );
}

/** Page hero for secondary marketing pages (features, pricing, faq, contact). */
export function PageIntro({
  eyebrow,
  title,
  description,
  breadcrumbs,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Breadcrumb trail for this page (also published as BreadcrumbList JSON-LD). */
  breadcrumbs?: SitePath;
  children?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden border-b px-4 pt-10 pb-14 sm:px-6 md:pt-14 md:pb-20">
      <Backdrop />
      <div className="relative mx-auto flex w-full max-w-6xl flex-col items-center gap-6">
        {breadcrumbs && <Breadcrumbs path={breadcrumbs} className="self-start" />}
        <SectionHeading
          as="h1"
          eyebrow={eyebrow}
          title={title}
          description={description}
          className={breadcrumbs ? "md:mt-4" : "mt-6 md:mt-10"}
        />
        {children}
      </div>
    </div>
  );
}

/** Soft brand glow + dotted grid, pure CSS. Decorative only. */
export function Backdrop({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0 -z-0", className)}>
      <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklch,var(--primary)_16%,transparent),transparent_70%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(color-mix(in_oklch,var(--foreground)_14%,transparent)_1px,transparent_1px)] [mask-image:radial-gradient(70%_60%_at_50%_0%,black,transparent)] [background-size:22px_22px] opacity-60" />
    </div>
  );
}
