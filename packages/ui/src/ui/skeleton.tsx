import type * as React from "react";

import { cn } from "../utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("rounded-md bg-muted motion-safe:animate-pulse dark:bg-accent", className)}
      {...props}
    />
  );
}

export { Skeleton };
