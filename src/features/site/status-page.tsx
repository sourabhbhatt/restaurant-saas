import type { ReactNode } from "react";

import { BrandLogo } from "./logo";
import { Backdrop } from "./section";

/** Full-page shell for 404 / error screens. */
export function StatusPage({
  code,
  title,
  description,
  children,
}: {
  code?: string;
  title: string;
  description: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-dvh flex-1 flex-col overflow-hidden">
      <Backdrop />
      <header className="relative px-4 py-5 sm:px-6">
        <BrandLogo />
      </header>
      <main
        id="main"
        className="relative flex flex-1 flex-col items-center justify-center gap-6 px-4 pb-24 text-center"
      >
        {code && (
          <p className="bg-gradient-to-b from-primary to-primary/40 bg-clip-text text-7xl font-semibold tracking-tighter text-transparent sm:text-8xl">
            {code}
          </p>
        )}
        <div className="flex max-w-md flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
          <div className="text-muted-foreground">{description}</div>
        </div>
        {children && (
          <div className="flex flex-wrap items-center justify-center gap-3">{children}</div>
        )}
      </main>
    </div>
  );
}
