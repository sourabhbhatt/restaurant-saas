"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ErrorState, PageHeader, PageSkeleton } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import type { WorkspaceDto } from "@/contracts/workspaces";
import { sessionKeys } from "@/features/session/queries";
import { api, errorMessage } from "@/lib/api-client";
import { useAction } from "@/lib/use-action";

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
  const { pending, run, err } = useAction();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Card>
      <CardContent className="pt-6">
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
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
          <FormField label="Workspace name" required error={err("name")}>
            <Input value={form.name} onChange={set("name")} disabled={!canEdit} />
          </FormField>
          <FormField label="Legal name" error={err("legalName")}>
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
          <FormField label="Tax ID (GSTIN / VAT)" error={err("taxId")}>
            <Input value={form.taxId} onChange={set("taxId")} disabled={!canEdit} />
          </FormField>
          <FormField label="Country (2-letter code)" error={err("country")}>
            <Input
              value={form.country}
              onChange={set("country")}
              maxLength={2}
              disabled={!canEdit}
            />
          </FormField>
          {canEdit && (
            <div className="sm:col-span-2">
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save changes"}
              </Button>
            </div>
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
      <PageHeader title="Workspace settings" description="Business details for your workspace." />
      <SettingsForm key={q.data.workspace.version} ws={q.data.workspace} canEdit={canEdit} />
    </div>
  );
}
