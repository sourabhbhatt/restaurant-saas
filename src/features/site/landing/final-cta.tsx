import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

import { BRAND } from "../brand";

export function FinalCta() {
  return (
    <section className="px-4 pb-20 sm:px-6 md:pb-28">
      <div className="relative mx-auto w-full max-w-6xl overflow-hidden rounded-3xl bg-primary px-6 py-16 text-center text-primary-foreground shadow-xl shadow-primary/20 sm:px-12 md:py-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(40%_60%_at_15%_0%,color-mix(in_oklch,white_22%,transparent),transparent),radial-gradient(40%_60%_at_85%_100%,color-mix(in_oklch,black_18%,transparent),transparent)]"
        />
        <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-6">
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Put your next service on {BRAND.name}
          </h2>
          <p className="text-lg text-pretty text-primary-foreground/85">
            Set up your menu and tables, print your QR codes, and invite your team — all within the
            free trial.
          </p>
          <div className="flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
            <Button
              asChild
              size="lg"
              variant="secondary"
              className="w-full bg-primary-foreground text-primary hover:bg-primary-foreground/90 sm:w-auto"
            >
              <Link href="/sign-up">
                Start free trial
                <ArrowRightIcon aria-hidden="true" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="ghost"
              className="w-full text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground sm:w-auto"
            >
              <Link href="/contact">Talk to us</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
