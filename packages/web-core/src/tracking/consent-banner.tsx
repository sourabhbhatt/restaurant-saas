"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { Button } from "@ros/ui/ui/button";

import { chooseAnalytics, type ConsentChoice } from "./consent";

/**
 * Small, non-blocking opt-in. Both choices have the same size, style and
 * position weight; nothing loads until "Allow" is pressed, and ignoring the
 * banner means no analytics. Reopened from "Cookie settings" (`takeFocus`),
 * it moves focus to its heading so keyboard and screen-reader users land on
 * it; on its first appearance it never takes focus from the page.
 */
export function ConsentBanner({
  current,
  takeFocus = false,
}: {
  current: ConsentChoice | null;
  takeFocus?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!takeFocus) return;
    // After the menu or link that opened it has finished returning focus to itself.
    const timer = window.setTimeout(() => heading.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [takeFocus]);
  return (
    <section
      role="region"
      aria-labelledby="analytics-consent-title"
      data-testid="analytics-consent"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md flex-col gap-3 rounded-lg border bg-background p-4 text-sm shadow-lg sm:right-auto sm:left-4 sm:mx-0"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="analytics-consent-title"
          ref={heading}
          tabIndex={-1}
          className="font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Help us improve RestaurantOS?
        </h2>
        <p className="text-muted-foreground">
          With your permission we use Google Analytics cookies to see which pages and features are
          used. No advertising, and nothing about your restaurant&apos;s data. You can change this
          any time from &ldquo;Cookie settings&rdquo; at the bottom of the page or, once signed in,
          in your account menu.{" "}
          <Link href="/legal/privacy#cookies" className="underline underline-offset-4">
            Privacy policy
          </Link>
          {current ? ` · Current choice: ${current === "granted" ? "allowed" : "declined"}.` : null}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => chooseAnalytics("denied")}>
          Decline
        </Button>
        <Button variant="outline" onClick={() => chooseAnalytics("granted")}>
          Allow analytics
        </Button>
      </div>
    </section>
  );
}
