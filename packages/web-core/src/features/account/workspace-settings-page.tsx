"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ErrorState, FormError, PageHeader, PageSkeleton } from "@ros/ui/shared/feedback";
import { Button } from "@ros/ui/ui/button";
import { Card, CardContent } from "@ros/ui/ui/card";
import { FormField } from "@ros/ui/ui/form-field";
import { Input } from "@ros/ui/ui/input";
import type { WorkspaceDto } from "@ros/contracts/workspaces";
import { sessionKeys } from "../session/queries";
import { api, errorMessage } from "@ros/api-client";
import { useAction } from "../../use-action";

type Response = { workspace: WorkspaceDto; membership: { permissions: string[] } };

function SettingsForm({ ws, canEdit }: { ws: WorkspaceDto; canEdit: boolean }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: ws.name,
    legalName: ws.legalName ?? "",
    businessEmail: ws.businessEmail ?? "",
    businessPhone: ws.businessPhone ?? "",
    taxId: ws.taxId ?? "",
    country: ws.country,
  });
  const [version, setVersion] = useState(ws.version);
  const { pending, run, err, formError, setFieldErrors } = useAction();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Card>
      <CardContent className="pt-6">
        <form
          className="grid gap-4 sm:grid-cols-2"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            const local: Record<string, string[]> = {};
            if (!form.name.trim()) local.name = ["Enter the workspace name"];
            if (!/^[A-Za-z]{2}$/.test(form.country))
              local.country = ["Use a 2-letter code, e.g. IN"];
            if (Object.keys(local).length > 0) {
              setFieldErrors(local);
              return;
            }
            const updated = await run(() =>
              api.patch<WorkspaceDto>(`/workspaces/${ws.id}`, { ...form, version }),
            );
            if (updated) {
              setVersion(updated.version);
              toast.success("Workspace updated");
              await Promise.all([
                qc.invalidateQueries({ queryKey: sessionKeys.structure(ws.id) }),
                qc.invalidateQueries({ queryKey: sessionKeys.me }),
              ]);
            }
          }}
        >
          <FormField
            label="Workspace name"
            description="Shown to your team in the workspace switcher. Guests see restaurant names instead."
            required
            error={err("name")}
          >
            <Input value={form.name} onChange={set("name")} disabled={!canEdit} />
          </FormField>
          <FormField
            label="Legal name"
            description="Optional. Your registered company name."
            error={err("legalName")}
          >
            <Input value={form.legalName} onChange={set("legalName")} disabled={!canEdit} />
          </FormField>
          <FormField label="Business email" error={err("businessEmail")}>
            <Input
              type="email"
              value={form.businessEmail}
              onChange={set("businessEmail")}
              disabled={!canEdit}
            />
          </FormField>
          <FormField label="Business phone" error={err("businessPhone")}>
            <Input value={form.businessPhone} onChange={set("businessPhone")} disabled={!canEdit} />
          </FormField>
          <FormField
            label="Tax ID (GSTIN / VAT)"
            description="Optional. Your GST or VAT registration number."
            error={err("taxId")}
          >
            <Input value={form.taxId} onChange={set("taxId")} disabled={!canEdit} />
          </FormField>
          <FormField
            label="Country"
            description="2-letter code, e.g. IN. New branches default to it."
            required
            error={err("country")}
          >
            <Input
              value={form.country}
              onChange={set("country")}
              maxLength={2}
              disabled={!canEdit}
            />
          </FormField>
          {canEdit ? (
            <div className="flex flex-col gap-3 sm:col-span-2">
              <FormError>{formError}</FormError>
              <Button type="submit" disabled={pending} className="self-start">
                {pending ? "Saving…" : "Save workspace details"}
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground sm:col-span-2">
              Only workspace owners and admins can change these details.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

export function WorkspaceSettingsPage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const q = useQuery({
    queryKey: ["workspace", workspaceId, "detail"],
    queryFn: ({ signal }) => api.get<Response>(`/workspaces/${workspaceId}`, undefined, signal),
  });
  if (q.isPending) return <PageSkeleton variant="detail" />;
  if (q.isError)
    return (
      <ErrorState
        title="Couldn't load settings"
        message={errorMessage(q.error)}
        onRetry={() => void q.refetch()}
      />
    );
  const canEdit = q.data.membership.permissions.includes("workspace.update");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Workspace settings"
        description="Business details of this workspace, your business account that holds your team, billing and plan. Restaurant branding and branch settings are set on each restaurant and branch."
      />
      <SettingsForm key={q.data.workspace.version} ws={q.data.workspace} canEdit={canEdit} />
    </div>
  );
}
