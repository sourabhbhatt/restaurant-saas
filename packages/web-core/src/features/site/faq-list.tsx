import { ChevronDownIcon } from "lucide-react";

import { cn } from "@ros/ui/utils";

import type { FaqItem } from "./faq-data";

/** Native <details> accordion: works without JavaScript and is keyboard accessible. */
export function FaqList({ items, className }: { items: FaqItem[]; className?: string }) {
  return (
    <div className={cn("divide-y rounded-2xl border bg-card", className)}>
      {items.map((item) => (
        <details key={item.id} id={item.id} className="group scroll-mt-24 px-5 sm:px-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left font-medium [&::-webkit-details-marker]:hidden">
            <span>{item.question}</span>
            <ChevronDownIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground group-open:rotate-180 motion-safe:transition-transform"
            />
          </summary>
          <div className="flex flex-col gap-3 pb-5 text-sm leading-relaxed text-muted-foreground">
            {item.answer.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
