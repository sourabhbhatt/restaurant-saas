"use client";

import Link from "next/link";

import { Button } from "@ros/ui/ui/button";

import { chooseAnalytics, type ConsentChoice } from "./consent";

/**
 * Small, non-blocking opt-in. Both choices have the same size, style and
 * position weight; nothing loads until "Allow" is pressed, and ignoring the
 * banner means no analytics.
 */
export function ConsentBanner({ current }: { current: ConsentChoice | null }) {
  return (
    <section
      role="region"
      aria-labelledby="analytics-consent-title"
      data-testid="analytics-consent"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md flex-col gap-3 rounded-lg border bg-background p-4 text-sm shadow-lg sm:right-auto sm:left-4 sm:mx-0"
    >
      <div className="flex flex-col gap-1">
        <h2 id="analytics-consent-title" className="font-semibold">
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
