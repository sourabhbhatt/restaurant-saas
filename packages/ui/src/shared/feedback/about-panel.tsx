"use client";

import * as React from "react";
import { Info, X } from "lucide-react";

import { cn } from "../../utils";
import { Button } from "../../ui/button";

const PREFIX = "ros:about:";
const listeners = new Set<() => void>();

function readHidden(key: string): boolean {
  try {
    return window.localStorage.getItem(PREFIX + key) === "hidden";
  } catch {
    return false;
  }
}

function writeHidden(key: string, hidden: boolean) {
  try {
    if (hidden) window.localStorage.setItem(PREFIX + key, "hidden");
    else window.localStorage.removeItem(PREFIX + key);
  } catch {
    // Storage may be blocked (private mode); the panel still toggles for this view.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

type AboutPanelProps = {
  /** Remembers per browser whether the panel is hidden. */
  storageKey: string;
  title: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

/**
 * A short explanatory "About" box. It can be hidden; a small "About …" button
 * stays in its place so the explanation is always one click away.
 */
function AboutPanel({ storageKey, title, children, className }: AboutPanelProps) {
  // Local choice wins for this view, so the toggle works even when storage is blocked.
  const [choice, setChoice] = React.useState<boolean | null>(null);
  const stored = React.useSyncExternalStore(
    subscribe,
    () => readHidden(storageKey),
    () => false,
  );
  const hidden = choice ?? stored;
  const contentId = React.useId();
  const toggle = (next: boolean) => {
    setChoice(next);
    writeHidden(storageKey, next);
  };

  if (hidden) {
    return (
      <div className={cn("flex", className)}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          aria-expanded={false}
          onClick={() => toggle(false)}
        >
          <Info aria-hidden /> {title}
        </Button>
      </div>
    );
  }
  return (
    <section
      id={contentId}
      data-slot="about-panel"
      aria-label={typeof title === "string" ? title : undefined}
      className={cn(
        "relative grid grid-cols-[1rem_1fr] gap-x-3 gap-y-1 rounded-lg border border-info/30 bg-info/5 px-4 py-3 pr-12 text-sm",
        className,
      )}
    >
      <Info className="mt-0.5 size-4 text-info" aria-hidden />
      <h2 className="font-medium text-foreground">{title}</h2>
      <div className="col-start-2 grid gap-1.5 text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground">
        {children}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-2 right-2"
        aria-label="Hide this explanation"
        aria-expanded
        aria-controls={contentId}
        onClick={() => toggle(true)}
      >
        <X aria-hidden />
      </Button>
    </section>
  );
}

export { AboutPanel };
export type { AboutPanelProps };
