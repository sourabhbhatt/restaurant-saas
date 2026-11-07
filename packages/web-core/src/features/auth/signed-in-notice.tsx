"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRightIcon, UserCheckIcon } from "lucide-react";

import { Button } from "@ros/ui/ui/button";
import { Spinner } from "@ros/ui/ui/spinner";
import type { MeResponse } from "@ros/contracts/auth";
import { useSignOut } from "../session/queries";

import { AuthCard } from "./auth-card";

export function SignedInNotice({ me, continueTo }: { me: MeResponse; continueTo: string }) {
  const signOut = useSignOut();
  const [signingOut, setSigningOut] = useState(false);
  return (
    <AuthCard
      icon={<UserCheckIcon />}
      title="You're signed in"
      description={
        <>
          Signed in as <span className="font-medium text-foreground">{me.user.email}</span>.
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <Button asChild size="lg">
          <Link href={continueTo}>
            Continue
            <ArrowRightIcon aria-hidden="true" />
          </Link>
        </Button>
        <Button
          variant="ghost"
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true);
            void signOut();
          }}
        >
          {signingOut && <Spinner decorative />}
          Use a different account
        </Button>
      </div>
    </AuthCard>
  );
}
