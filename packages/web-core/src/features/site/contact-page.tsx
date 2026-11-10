import Link from "next/link";
import { BookOpenIcon, LifeBuoyIcon, MailIcon } from "lucide-react";

import { Button } from "@ros/ui/ui/button";

import { BRAND } from "./brand";
import { PageIntro, Section } from "./section";
import { supportMailto, WithSiteContact } from "./site-contact";

export function ContactPage() {
  const subject = `${BRAND.name} enquiry`;
  return (
    <>
      <PageIntro
        breadcrumbs="/contact"
        eyebrow="Contact"
        title="Talk to a human"
        description="Questions about plans, setting up your restaurant or custom pricing? Email us and we'll get back to you."
      />
      <Section className="py-14 md:py-20">
        <div className="mx-auto grid max-w-4xl gap-5 md:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col gap-5 rounded-2xl border bg-card p-6 shadow-xs sm:p-8">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MailIcon aria-hidden="true" className="size-5" />
            </span>
            <div className="flex flex-col gap-1.5">
              <h2 className="text-xl font-semibold tracking-tight">Email us</h2>
              <p className="text-sm text-muted-foreground">
                Sales, onboarding, plan activation, billing and privacy requests all go to the same
                inbox.
              </p>
            </div>
            {/* The address is a runtime setting (SITE_SUPPORT_EMAIL), read per request. */}
            <WithSiteContact
              fallback={
                <p className="text-lg font-semibold text-muted-foreground">Our email address</p>
              }
            >
              {(contact) => (
                <>
                  <a
                    href={supportMailto(contact)}
                    className="w-fit text-lg font-semibold break-all text-primary underline-offset-4 hover:underline"
                  >
                    {contact.supportEmail}
                  </a>
                  <Button asChild className="w-fit">
                    <a href={supportMailto(contact, subject)}>
                      <MailIcon aria-hidden="true" />
                      Write an email
                    </a>
                  </Button>
                </>
              )}
            </WithSiteContact>
            <p className="text-xs text-muted-foreground">
              Helpful to include: your restaurant name, city, number of branches and what you&apos;d
              like to do.
            </p>
          </div>
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2 rounded-2xl border bg-card p-6">
              <LifeBuoyIcon aria-hidden="true" className="size-5 text-primary" />
              <h2 className="font-semibold">Already a customer?</h2>
              <p className="text-sm text-muted-foreground">
                Sign in and open a support request from your workspace so we have your account
                details.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-1 w-fit">
                <Link href="/sign-in">Sign in</Link>
              </Button>
            </div>
            <div className="flex flex-col gap-2 rounded-2xl border bg-card p-6">
              <BookOpenIcon aria-hidden="true" className="size-5 text-primary" />
              <h2 className="font-semibold">Quick answers</h2>
              <p className="text-sm text-muted-foreground">
                Offline use, payments, trials and what&apos;s not supported yet.
              </p>
              <Button asChild variant="outline" size="sm" className="mt-1 w-fit">
                <Link href="/faq">Read the FAQ</Link>
              </Button>
            </div>
          </div>
        </div>
      </Section>
    </>
  );
}
