"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Archive, ChevronLeft, MapPin, Plus, Settings, Users } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  PageSkeleton,
} from "@ros/ui/shared/feedback";
import { Button } from "@ros/ui/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ros/ui/ui/card";
import { FormField } from "@ros/ui/ui/form-field";
import { Spinner } from "@ros/ui/ui/spinner";
import { Switch } from "@ros/ui/ui/switch";
import { Textarea } from "@ros/ui/ui/textarea";
import { restaurantSettingsSchema, type RestaurantDetailDto } from "@ros/contracts/tenancy";
import { ApiError, applyFieldErrors, errorMessage } from "@ros/api-client";

import { CreateBranchDialog } from "./create-branch-dialog";
import { useArchiveRestaurant, useRestaurant, useUpdateRestaurant } from "./queries";
import { RestaurantForm } from "./restaurant-form";
import { RestaurantLogo } from "./restaurants-page";

type SettingsInput = z.input<typeof restaurantSettingsSchema>;
type SettingsOutput = z.output<typeof restaurantSettingsSchema>;

function CustomerMenuSettings({
  workspaceId,
  restaurant,
  disabled,
}: {
  workspaceId: string;
  restaurant: RestaurantDetailDto;
  disabled: boolean;
}) {
  const update = useUpdateRestaurant(workspaceId, restaurant.id);
  const form = useForm<SettingsInput, unknown, SettingsOutput>({
    resolver: zodResolver(restaurantSettingsSchema),
    defaultValues: {
      showPrepTime: restaurant.settings.showPrepTime,
      showAllergens: restaurant.settings.showAllergens,
      welcomeMessage: restaurant.settings.welcomeMessage ?? "",
    },
  });
  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = form;
  const submit = handleSubmit(async (settings) => {
    try {
      await update.mutateAsync({ settings, version: restaurant.version });
      form.reset(form.getValues());
      toast.success("Customer menu settings saved");
    } catch (error) {
      if (!applyFieldErrors(error, setError, ["welcomeMessage"])) toast.error(errorMessage(error));
    }
  });
  const toggle = (name: "showPrepTime" | "showAllergens", label: string, hint: string) => (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <label className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <span className="grid gap-0.5">
            <span className="text-sm font-medium">{label}</span>
            <span className="text-sm text-muted-foreground">{hint}</span>
          </span>
          <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
        </label>
      )}
    />
  );
  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <fieldset disabled={disabled} className="grid gap-4">
        {toggle("showPrepTime", "Show preparation time", "Customers see estimated prep time.")}
        {toggle("showAllergens", "Show allergens", "Allergen tags appear on menu items.")}
        <FormField
          label="Welcome message"
          description="Shown at the top of the QR menu."
          error={errors.welcomeMessage?.message}
        >
          <Textarea rows={2} {...register("welcomeMessage")} />
        </FormField>
      </fieldset>
      {!disabled && (
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting || !isDirty}>
            {isSubmitting && <Spinner decorative />} Save
          </Button>
        </div>
      )}
    </form>
  );
}

export function RestaurantDetailPage() {
  const { workspaceId, restaurantId } = useParams<{ workspaceId: string; restaurantId: string }>();
  const router = useRouter();
  const query = useRestaurant(restaurantId);
  const update = useUpdateRestaurant(workspaceId, restaurantId);
  const archive = useArchiveRestaurant(workspaceId);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);

  const back = (
    <Link
      href={`/app/w/${workspaceId}/restaurants`}
      className="inline-flex items-center gap-1 hover:text-foreground"
    >
      <ChevronLeft className="size-4" aria-hidden /> Restaurants
    </Link>
  );

  if (query.isPending) return <PageSkeleton variant="detail" />;
  if (query.isError) {
    const missing = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Restaurant" breadcrumbs={back} />
        <ErrorState
          title={missing ? "Restaurant not found" : "Couldn't load this restaurant"}
          message={
            missing
              ? "It may have been archived, or you don't have access to it."
              : errorMessage(query.error)
          }
          onRetry={missing ? undefined : () => void query.refetch()}
        />
      </div>
    );
  }

  const r = query.data;
  const can = (p: string) => (r.permissions as string[]).includes(p);
  const canEdit = can("restaurant.update");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumbs={back}
        title={
          <span className="flex items-center gap-3">
            <RestaurantLogo
              name={r.name}
              logoKey={r.logoKey}
              brandColor={r.brandColor}
              className="size-10"
            />
            <span className="truncate">{r.name}</span>
          </span>
        }
        description={r.description ?? undefined}
        actions={
          can("restaurant.delete") ? (
            <Button variant="outline" onClick={() => setArchiveOpen(true)}>
              <Archive aria-hidden /> Archive
            </Button>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
              <CardDescription>
                {canEdit ? "Name, branding and contact details." : "You can view these details."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {canEdit ? (
                <RestaurantForm
                  key={r.version}
                  workspaceId={workspaceId}
                  requireDirty
                  defaultValues={{
                    name: r.name,
                    description: r.description ?? "",
                    cuisineTypes: r.cuisineTypes,
                    logoKey: r.logoKey,
                    coverKey: r.coverKey,
                    contactEmail: r.contactEmail ?? "",
                    contactPhone: r.contactPhone ?? "",
                    website: r.website ?? "",
                    brandColor: r.brandColor ?? "",
                  }}
                  submitLabel="Save changes"
                  onSubmit={async (values) => {
                    await update.mutateAsync({ ...values, version: r.version });
                    toast.success("Restaurant updated");
                  }}
                />
              ) : (
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  {(
                    [
                      ["Cuisines", r.cuisineTypes.join(", ")],
                      ["Email", r.contactEmail],
                      ["Phone", r.contactPhone],
                      ["Website", r.website],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="font-medium">{value || "—"}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Customer menu</CardTitle>
              <CardDescription>How the QR menu looks to guests.</CardDescription>
            </CardHeader>
            <CardContent>
              <CustomerMenuSettings
                key={r.version}
                workspaceId={workspaceId}
                restaurant={r}
                disabled={!canEdit}
              />
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div>
              <CardTitle>Branches</CardTitle>
              <CardDescription>{r.branches.length} active</CardDescription>
            </div>
            {can("branch.create") && (
              <Button size="sm" onClick={() => setBranchOpen(true)}>
                <Plus aria-hidden /> Add
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {r.branches.length === 0 ? (
              <EmptyState
                size="compact"
                icon={<MapPin />}
                title="No branches"
                description="Add a branch to start taking orders."
              />
            ) : (
              <ul className="flex flex-col divide-y">
                {r.branches.map((b) => (
                  <li key={b.id} className="flex items-center gap-2 py-2.5">
                    <Link href={`/app/b/${b.id}`} className="min-w-0 flex-1 hover:underline">
                      <span className="block truncate text-sm font-medium">{b.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[b.code, b.city, b.currency].filter(Boolean).join(" · ")}
                      </span>
                    </Link>
                    <Button variant="ghost" size="icon-sm" asChild>
                      <Link href={`/app/b/${b.id}/staff`} aria-label={`Staff of ${b.name}`}>
                        <Users aria-hidden />
                      </Link>
                    </Button>
                    <Button variant="ghost" size="icon-sm" asChild>
                      <Link href={`/app/b/${b.id}/settings`} aria-label={`Settings of ${b.name}`}>
                        <Settings aria-hidden />
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <CreateBranchDialog
        workspaceId={workspaceId}
        restaurant={branchOpen ? { id: r.id, name: r.name } : null}
        open={branchOpen}
        onOpenChange={setBranchOpen}
      />
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        destructive
        title={`Archive ${r.name}?`}
        description={`The restaurant and its ${r.branches.length} branch${r.branches.length === 1 ? "" : "es"} will be hidden and stop accepting orders. Past orders and bills are kept.`}
        confirmLabel="Archive restaurant"
        pendingLabel="Archiving…"
        getErrorMessage={errorMessage}
        onConfirm={async () => {
          await archive.mutateAsync(r.id);
          toast.success(`${r.name} archived`);
          router.replace(`/app/w/${workspaceId}/restaurants`);
        }}
      />
    </div>
  );
}
