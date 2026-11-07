import Link from "next/link";
import { ArrowRightIcon, CheckCircle2Icon } from "lucide-react";

import { Button } from "@ros/ui/ui/button";

import { Backdrop } from "../section";
import { ProductMockup } from "./product-mockup";

const POINTS = ["No app for guests", "Waiter approves every order", "Free trial, no card"];

export function Hero() {
  return (
    <section className="relative overflow-hidden px-4 pt-14 pb-28 sm:px-6 md:pt-24 md:pb-36">
      <Backdrop />
      <div className="relative mx-auto flex w-full max-w-6xl flex-col items-center gap-14 md:gap-20">
        <div className="flex max-w-3xl flex-col items-center gap-6 text-center">
          <Link
            href="/features"
            className="group inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground shadow-xs backdrop-blur hover:text-foreground"
          >
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">Dine-in</span>
            QR ordering · Kitchen display · Counter billing
            <ArrowRightIcon
              aria-hidden="true"
              className="size-3 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5"
            />
          </Link>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl md:text-6xl">
            Table ordering that keeps <span className="text-primary">your team in control</span>
          </h1>
          <p className="max-w-2xl text-lg text-pretty text-muted-foreground">
            Guests scan, browse and order from their phones — no app, no account. Waiters approve
            every order, the kitchen sees it on a live display, and the counter settles the bill.
            Across every restaurant and branch you run.
          </p>
          <div className="flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href="/sign-up">
                Start free trial
                <ArrowRightIcon aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
              <Link href="#how-it-works">See how it works</Link>
            </Button>
          </div>
          <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            {POINTS.map((p) => (
              <li key={p} className="inline-flex items-center gap-1.5">
                <CheckCircle2Icon aria-hidden="true" className="size-4 text-success" />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <ProductMockup />
      </div>
    </section>
  );
}
