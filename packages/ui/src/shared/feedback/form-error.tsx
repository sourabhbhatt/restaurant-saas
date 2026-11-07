import type * as React from "react";
import { AlertCircle } from "lucide-react";

import { cn } from "../../utils";

type FormErrorProps = Omit<React.ComponentProps<"div">, "children"> & {
  /** The message; nothing renders when empty. */
  children?: React.ReactNode;
};

/** A form-level error shown next to the submit button (not only as a toast). */
function FormError({ children, className, ...props }: FormErrorProps) {
  if (children == null || children === false || children === "") return null;
  return (
    <div
      role="alert"
      data-slot="form-error"
      className={cn(
        "flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive",
        className,
      )}
      {...props}
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="grid gap-1">{children}</div>
    </div>
  );
}

export { FormError };
export type { FormErrorProps };
