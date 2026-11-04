"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { PageSkeleton } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ProfileMenu } from "@/features/navigation/profile-menu";
import { AuthGate } from "@/features/session/auth-gate";
import { sessionKeys, useMe } from "@/features/session/queries";
import { api } from "@/lib/api-client";
import { useAction } from "@/lib/use-action";

function ProfileCard({ initialName }: { initialName: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState(initialName);
  const { pending, run, err } = useAction();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run(() => api.patch("/account/profile", { name }));
            if (ok) {
              toast.success("Profile updated");
              await qc.invalidateQueries({ queryKey: sessionKeys.me });
            }
          }}
        >
          <FormField label="Full name" required error={err("name")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          <Button type="submit" disabled={pending} className="self-start">
            {pending ? "Saving…" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const { pending, run, err } = useAction();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>Other devices are signed out when you change it.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run(() =>
              api.put("/auth/password", { currentPassword: current, newPassword: next }),
            );
            if (ok) {
              toast.success("Password changed");
              setCurrent("");
              setNext("");
            }
          }}
        >
          <FormField label="Current password" required error={err("currentPassword")}>
            <Input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
            />
          </FormField>
          <FormField
            label="New password"
            required
            error={err("newPassword")}
            description="At least 10 characters with a letter and a number."
          >
            <Input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
            />
          </FormField>
          <Button type="submit" disabled={pending} className="self-start">
            {pending ? "Saving…" : "Change password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Inner() {
  const me = useMe();
  const { pending, run } = useAction();
  if (!me.data) return <PageSkeleton variant="detail" />;
  const activeId = me.data.activeWorkspaceId;
  const active = me.data.workspaces.find((w) => w.id === activeId);
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Account</h1>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost">
            <Link href={activeId ? `/app/w/${activeId}` : "/app"}>← Back to dashboard</Link>
          </Button>
          <ProfileMenu
            workspaceId={activeId ?? undefined}
            workspaceName={active?.name}
            roleLabel={active?.roleName}
          />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Signed in as {me.data.user.email}
        {me.data.user.emailVerified ? " (verified)" : " (not verified)"}
      </p>
      {!me.data.user.emailVerified && (
        <Button
          variant="outline"
          className="self-start"
          disabled={pending}
          onClick={async () => {
            if (await run(() => api.post("/auth/resend-verification")))
              toast.success("Verification email sent");
          }}
        >
          Resend verification email
        </Button>
      )}
      <ProfileCard initialName={me.data.user.name} />
      <PasswordCard />
    </div>
  );
}

export function AccountPage() {
  return (
    <AuthGate>
      <Inner />
    </AuthGate>
  );
}
