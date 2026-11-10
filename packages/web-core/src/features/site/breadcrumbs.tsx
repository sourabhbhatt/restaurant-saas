import Link from "next/link";
import { ChevronRightIcon } from "lucide-react";

import { breadcrumbTrail, type SitePath } from "./seo/site-pages";

/** Visible breadcrumb trail; the same trail is published as BreadcrumbList JSON-LD. */
export function Breadcrumbs({ path, className }: { path: SitePath; className?: string }) {
  const trail = breadcrumbTrail(path);
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
        {trail.map((page, i) => {
          const last = i === trail.length - 1;
          return (
            <li key={page.path} className="inline-flex items-center gap-1">
              {last ? (
                <span aria-current="page" className="font-medium text-foreground">
                  {page.label}
                </span>
              ) : (
                <>
                  <Link
                    href={page.path}
                    className="rounded-sm hover:text-foreground hover:underline"
                  >
                    {page.label}
                  </Link>
                  <ChevronRightIcon aria-hidden="true" className="size-3.5 shrink-0" />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
