"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import { AboutPanel, FormError, PageSkeleton } from "@ros/ui/shared/feedback";
import { Button } from "@ros/ui/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ros/ui/ui/card";
import { FormField } from "@ros/ui/ui/form-field";
import { Input } from "@ros/ui/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ros/ui/ui/select";
import type { TableDto } from "@ros/contracts/tables";
import type { BranchDto, RestaurantDto } from "@ros/contracts/tenancy";
import type { OrganizationSummaryDto, WorkspaceDto } from "@ros/contracts/workspaces";
import { toMinor } from "@ros/domain/shared/money";
import { sessionKeys, useMe } from "@ros/web-core/features/session/queries";
import { UpgradeButton } from "@ros/web-core/features/subscriptions/upgrade-modal";
import { isPlanError } from "@ros/web-core/features/subscriptions/limits";
import {
  PlanErrorNotice,
  PlanLimitsLine,
  useLimit,
} from "@ros/web-core/features/subscriptions/limit-notice";
import {
  invalidateEntitlements,
  useEntitlements,
} from "@ros/web-core/features/subscriptions/queries";
import { api, ApiError } from "@ros/api-client";
import { asOneAction } from "@ros/web-core/tracking/api-events";
import { useAction } from "@ros/web-core/use-action";

type Step = "workspace" | "restaurant" | "menu" | "tables" | "done";
const STEPS: { key: Step; label: string }[] = [
  { key: "workspace", label: "Business" },
  { key: "restaurant", label: "Restaurant" },
  { key: "menu", label: "Menu" },
  { key: "tables", label: "Tables" },
  { key: "done", label: "Done" },
];

interface Progress {
  workspaceId: string | null;
  restaurantId: string | null;
  branchId: string | null;
}

function StepForm(props: {
  title: string;
  description: string;
  onSubmit: () => void;
  pending: boolean;
  submitLabel: string;
  children: ReactNode;
  onSkip?: () => void;
  /** Shown right above the buttons (form-level and plan errors). */
  notice?: ReactNode;
  /** Why the submit button is disabled, shown under it. */
  blockedReason?: string | null;
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    props.onSubmit();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-lg">{props.title}</h1>
        </CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {props.children}
          {props.notice}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              type="submit"
              disabled={props.pending || Boolean(props.blockedReason)}
              aria-describedby={props.blockedReason ? "step-blocked-reason" : undefined}
            >
              {props.pending ? "Saving…" : props.submitLabel}
            </Button>
            {props.onSkip ? (
              <Button type="button" variant="ghost" onClick={props.onSkip} disabled={props.pending}>
                Skip this step
              </Button>
            ) : null}
          </div>
          {props.blockedReason ? (
            <p id="step-blocked-reason" className="text-sm text-muted-foreground">
              {props.blockedReason}
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

function Wizard() {
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const forceNew = useSearchParams().get("new") === "1";
  const [progress, setProgress] = useState<Progress>({
    workspaceId: null,
    restaurantId: null,
    branchId: null,
  });
  const [step, setStep] = useState<Step | null>(null);
  const [firstCategoryId, setFirstCategoryId] = useState<string | null>(null);

  // Resume: pick up saved onboarding progress of the active workspace.
  const activeId = me.data?.activeWorkspaceId ?? null;
  useEffect(() => {
    if (!me.data || step !== null || forceNew || !activeId) return;
    let cancelled = false;
    api
      .get<{ workspace: WorkspaceDto }>(`/workspaces/${activeId}`)
      .then(({ workspace }) => {
        if (cancelled) return;
        const o = workspace.onboarding;
        setProgress({
          workspaceId: workspace.id,
          restaurantId: o.restaurantId ?? null,
          branchId: o.branchId ?? null,
        });
        const done = new Set(o.completedSteps);
        if (!o.restaurantId || !o.branchId) setStep("restaurant");
        else if (!done.has("menu")) setStep("menu");
        else if (!done.has("tables")) setStep("tables");
        else setStep("done");
      })
      .catch(() => !cancelled && setStep("workspace"));
    return () => {
      cancelled = true;
    };
  }, [me.data, step, forceNew, activeId]);

  const saveProgress = (workspaceId: string, body: Record<string, unknown>) =>
    api.put(`/workspaces/${workspaceId}/onboarding`, body).catch(() => undefined);

  // No workspace yet (or explicitly creating another): start at the first step.
  const startsFresh = Boolean(me.data) && (forceNew || !activeId);
  const activeStep: Step | null = step ?? (startsFresh ? "workspace" : null);
  if (me.isPending || activeStep === null) return <PageSkeleton variant="detail" />;
  const currentIndex = STEPS.findIndex((s) => s.key === activeStep);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <OnboardingExplainer workspaceId={progress.workspaceId} />
      <ol className="flex items-center justify-between gap-2" aria-label="Setup progress">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex flex-1 flex-col items-center gap-1 text-xs">
            <span
              className={`flex size-7 items-center justify-center rounded-full border text-xs font-semibold ${
                i < currentIndex
                  ? "border-transparent bg-primary text-primary-foreground"
                  : i === currentIndex
                    ? "border-primary text-primary"
                    : "text-muted-foreground"
              }`}
              aria-current={i === currentIndex ? "step" : undefined}
            >
              {i < currentIndex ? <Check className="size-4" aria-hidden /> : i + 1}
            </span>
            <span className={i === currentIndex ? "font-medium" : "text-muted-foreground"}>
              {s.label}
            </span>
          </li>
        ))}
      </ol>

      {activeStep === "workspace" && (
        <WorkspaceStep
          activeWorkspaceId={activeId}
          onDone={async (ws) => {
            await qc.invalidateQueries({ queryKey: sessionKeys.me });
            setProgress({ workspaceId: ws.id, restaurantId: null, branchId: null });
            await saveProgress(ws.id, { completedStep: "business" });
            setStep("restaurant");
          }}
        />
      )}
      {activeStep === "restaurant" && progress.workspaceId && (
        <RestaurantStep
          workspaceId={progress.workspaceId}
          onDone={async (restaurantId, branchId) => {
            setProgress((p) => ({ ...p, restaurantId, branchId }));
            await saveProgress(progress.workspaceId!, {
              completedStep: "branch",
              restaurantId,
              branchId,
            });
            await Promise.all([
              qc.invalidateQueries({ queryKey: sessionKeys.structure(progress.workspaceId!) }),
              invalidateEntitlements(qc, progress.workspaceId!),
            ]);
            setStep("menu");
          }}
        />
      )}
      {activeStep === "menu" && progress.restaurantId && progress.workspaceId && (
        <MenuStep
          workspaceId={progress.workspaceId}
          restaurantId={progress.restaurantId}
          categoryId={firstCategoryId}
          onCategory={setFirstCategoryId}
          onDone={async () => {
            await saveProgress(progress.workspaceId!, { completedStep: "menu" });
            setStep("tables");
          }}
        />
      )}
      {activeStep === "tables" && progress.branchId && progress.workspaceId && (
        <TablesStep
          workspaceId={progress.workspaceId}
          branchId={progress.branchId}
          onDone={async () => {
            await saveProgress(progress.workspaceId!, { completedStep: "tables" });
            await invalidateEntitlements(qc, progress.workspaceId!);
            setStep("done");
          }}
        />
      )}
      {activeStep === "done" && progress.branchId && progress.workspaceId && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h1 className="text-lg">Your restaurant is set up</h1>
            </CardTitle>
            <CardDescription>
              Next, print your table QR codes and place a test order. The checklist on your
              dashboard walks you through it in about 10 minutes.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 sm:flex-row">
            <Button
              onClick={async () => {
                // Not dismissed: the dashboard checklist takes over from here.
                await saveProgress(progress.workspaceId!, { completedStep: "done" });
                router.push(`/app/b/${progress.branchId}`);
              }}
            >
              Go to my dashboard
            </Button>
            <Button asChild variant="outline">
              <Link href={`/print/tables?branchId=${progress.branchId}`}>Print QR codes</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Plain-words definitions, plus the plan's numbers once the workspace exists. */
function OnboardingExplainer({ workspaceId }: { workspaceId: string | null }) {
  const ent = useEntitlements(workspaceId ?? undefined);
  return (
    <AboutPanel storageKey="onboarding" title="How RestaurantOS is organised">
      <p>
        <strong>Workspace</strong>: your business account. Team members, roles, billing and plan
        limits live here. On a trial or monthly plan an organization has one workspace.
      </p>
      <p>
        <strong>Restaurant</strong>: a brand or concept with its own menu and branding, e.g.
        &ldquo;Saffron Kitchen&rdquo;.
      </p>
      <p>
        <strong>Branch</strong>: a physical location of a restaurant with its own tables, staff,
        settings, orders and bills, e.g. &ldquo;Indiranagar&rdquo;.
      </p>
      {ent.data ? <PlanLimitsLine entitlements={ent.data.entitlements} /> : null}
    </AboutPanel>
  );
}

function WorkspaceStep({
  activeWorkspaceId,
  onDone,
}: {
  activeWorkspaceId: string | null;
  onDone: (ws: WorkspaceDto) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [organizationId, setOrganizationId] = useState<string | undefined>(undefined);
  const [blocked, setBlocked] = useState<{ code: string; message: string } | null>(null);
  const { pending, run, err, error, formError, setFieldErrors } = useAction();
  const orgs = useQuery({
    queryKey: ["organizations", "mine"],
    queryFn: ({ signal }) => api.get<OrganizationSummaryDto[]>("/organizations", undefined, signal),
  });
  const owned = (orgs.data ?? []).filter((o) => o.role === "OWNER");
  return (
    <StepForm
      title="Name your business"
      description={
        owned.length > 0
          ? "This is a new workspace in your organization; it shares the organization's plan."
          : "This is your workspace. You can run several restaurants and branches inside it. Your free trial starts now."
      }
      pending={pending}
      submitLabel="Create workspace"
      notice={!blocked && !isPlanError(error) ? <FormError>{formError}</FormError> : null}
      onSubmit={async () => {
        setBlocked(null);
        if (!name.trim()) {
          setFieldErrors({ name: ["Enter your business name"] });
          return;
        }
        if (owned.length > 1 && !organizationId) {
          setFieldErrors({ organizationId: ["Choose an organization"] });
          return;
        }
        const ws = await run(async () => {
          try {
            return await api.post<WorkspaceDto>("/workspaces", { name, organizationId });
          } catch (error) {
            if (
              error instanceof ApiError &&
              (error.code === "LIMIT_REACHED" || error.code === "TRIAL_ALREADY_USED")
            ) {
              setBlocked({ code: error.code, message: error.message });
              return null;
            }
            throw error;
          }
        });
        if (ws) await onDone(ws);
      }}
    >
      <FormField
        label="Business name"
        description="Your company or group name. Guests don't see it; they see restaurant names."
        required
        error={err("name")}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Saffron Hospitality"
          autoFocus
        />
      </FormField>
      {owned.length > 1 ? (
        <FormField label="Organization" required error={err("organizationId")}>
          {(control) => (
            <Select value={organizationId ?? ""} onValueChange={setOrganizationId}>
              <SelectTrigger {...control}>
                <SelectValue placeholder="Choose an organization" />
              </SelectTrigger>
              <SelectContent>
                {owned.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name} · {o.workspaceCount}/{o.maxWorkspaces} workspaces
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      ) : null}
      {blocked ? (
        <div role="alert" className="rounded-md border bg-muted/40 p-3 text-sm">
          <p>{blocked.message}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {blocked.code === "LIMIT_REACHED" && activeWorkspaceId ? (
              <UpgradeButton workspaceId={activeWorkspaceId} size="sm">
                Request an upgrade
              </UpgradeButton>
            ) : null}
            {activeWorkspaceId ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/app/w/${activeWorkspaceId}/subscription`}>
                  {blocked.code === "TRIAL_ALREADY_USED"
                    ? "Upgrade your existing organization"
                    : "View subscription"}
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </StepForm>
  );
}

function RestaurantStep({
  workspaceId,
  onDone,
}: {
  workspaceId: string;
  onDone: (restaurantId: string, branchId: string) => void | Promise<void>;
}) {
  const [restaurant, setRestaurant] = useState("");
  const [branch, setBranch] = useState("Main Branch");
  const [city, setCity] = useState("");
  // Kept so a failed branch step never creates a second restaurant on retry.
  const [created, setCreated] = useState<RestaurantDto | null>(null);
  const restaurantAction = useAction();
  const branchAction = useAction();
  const limit = useLimit(workspaceId, "maxRestaurants");
  const pending = restaurantAction.pending || branchAction.pending;
  const failed = restaurantAction.error ?? branchAction.error;
  const otherError = restaurantAction.error ? restaurantAction.formError : branchAction.formError;
  return (
    <StepForm
      title="Your first restaurant"
      description="Add the restaurant (your brand) and its first branch (a location). Tax, hours and address can be refined later in the branch settings."
      pending={pending}
      submitLabel={created ? "Create branch" : "Create restaurant and branch"}
      blockedReason={created ? null : limit.reason}
      notice={
        <>
          <PlanErrorNotice error={failed} workspaceId={workspaceId} />
          {!isPlanError(failed) ? <FormError>{otherError}</FormError> : null}
        </>
      }
      onSubmit={async () => {
        const local: Record<string, string[]> = {};
        if (!created && !restaurant.trim()) local.name = ["Enter the restaurant name"];
        if (!branch.trim()) local.branchName = ["Enter a name for the first branch"];
        restaurantAction.setFieldErrors(local.name ? { name: local.name } : {});
        branchAction.setFieldErrors(local.branchName ? { name: local.branchName } : {});
        if (Object.keys(local).length > 0) return;
        let r = created;
        if (!r) {
          r = await restaurantAction.run(() =>
            api.post<RestaurantDto>(`/workspaces/${workspaceId}/restaurants`, {
              name: restaurant,
            }),
          );
          if (!r) return;
          setCreated(r);
        }
        const restaurantId = r.id;
        const b = await branchAction.run(() =>
          api.post<BranchDto>(`/restaurants/${restaurantId}/branches`, {
            name: branch,
            city: city || undefined,
          }),
        );
        if (b) await onDone(restaurantId, b.id);
      }}
    >
      <FormField
        label="Restaurant name"
        description="The brand guests see on the QR menu."
        required
        error={restaurantAction.err("name")}
      >
        <Input
          value={created ? created.name : restaurant}
          onChange={(e) => setRestaurant(e.target.value)}
          disabled={Boolean(created)}
          autoFocus
        />
      </FormField>
      <FormField
        label="First branch name"
        description="Usually the area or street, e.g. Indiranagar."
        required
        error={branchAction.err("name")}
      >
        <Input value={branch} onChange={(e) => setBranch(e.target.value)} />
      </FormField>
      <FormField label="City" description="Optional." error={branchAction.err("city")}>
        <Input value={city} onChange={(e) => setCity(e.target.value)} />
      </FormField>
    </StepForm>
  );
}

function MenuStep({
  workspaceId,
  restaurantId,
  categoryId,
  onCategory,
  onDone,
}: {
  workspaceId: string;
  restaurantId: string;
  categoryId: string | null;
  onCategory: (id: string) => void;
  onDone: () => void | Promise<void>;
}) {
  const [category, setCategory] = useState("Mains");
  const [item, setItem] = useState("");
  const [price, setPrice] = useState("");
  const [dietary, setDietary] = useState<"VEG" | "NON_VEG">("VEG");
  const categoryAction = useAction();
  const itemAction = useAction();
  const pending = categoryAction.pending || itemAction.pending;
  const failed = categoryAction.error ?? itemAction.error;
  return (
    <StepForm
      title="Add your first dish"
      description="Start with one category and one item. Variants, add-ons, photos and the rest of the menu are managed on the Menu page. The menu is shared by every branch of the restaurant."
      pending={pending}
      submitLabel="Add dish and continue"
      onSkip={() => void onDone()}
      notice={
        <>
          <PlanErrorNotice error={failed} workspaceId={workspaceId} />
          {!isPlanError(failed) ? (
            <FormError>{categoryAction.formError ?? itemAction.formError}</FormError>
          ) : null}
        </>
      }
      onSubmit={async () => {
        const amount = Number(price);
        const local: Record<string, string[]> = {};
        if (!categoryId && !category.trim()) local.category = ["Enter a category name"];
        if (!item.trim()) local.name = ["Enter the dish name"];
        if (price.trim() === "" || !Number.isFinite(amount) || amount < 0)
          local.price = ["Enter a price of 0 or more, e.g. 249"];
        categoryAction.setFieldErrors(local.category ? { name: local.category } : {});
        itemAction.setFieldErrors({
          ...(local.name ? { name: local.name } : {}),
          ...(local.price ? { price: local.price } : {}),
        });
        if (Object.keys(local).length > 0) return;
        let cid = categoryId;
        if (!cid) {
          const c = await categoryAction.run(() =>
            api.post<{ id: string }>(`/restaurants/${restaurantId}/menu/categories`, {
              name: category,
            }),
          );
          if (!c) return;
          cid = c.id;
          onCategory(cid);
        }
        const categoryIdToUse = cid;
        const ok = await itemAction.run(() =>
          api.post(`/restaurants/${restaurantId}/menu/items`, {
            categoryId: categoryIdToUse,
            name: item,
            price: toMinor(amount),
            dietary,
            prepTimeMinutes: 15,
            allergens: [],
          }),
        );
        if (ok) await onDone();
      }}
    >
      <FormField
        label="Category"
        description={
          categoryId ? "Created. Add more categories on the Menu page." : "e.g. Mains, Starters"
        }
        required
        error={categoryAction.err("name")}
      >
        <Input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          disabled={Boolean(categoryId)}
        />
      </FormField>
      <FormField label="Dish name" required error={itemAction.err("name")}>
        <Input value={item} onChange={(e) => setItem(e.target.value)} placeholder="Paneer Tikka" />
      </FormField>
      <FormField
        label="Price"
        description="In the branch currency, e.g. 249 or 249.50."
        required
        error={itemAction.err("price")}
      >
        <Input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          inputMode="decimal"
          placeholder="249"
        />
      </FormField>
      <div className="flex gap-2" role="radiogroup" aria-label="Dietary type">
        {(["VEG", "NON_VEG"] as const).map((d) => (
          <Button
            key={d}
            type="button"
            variant={dietary === d ? "default" : "outline"}
            role="radio"
            aria-checked={dietary === d}
            onClick={() => setDietary(d)}
          >
            {d === "VEG" ? "Vegetarian" : "Non-vegetarian"}
          </Button>
        ))}
      </div>
    </StepForm>
  );
}

/** QR codes created at once during onboarding: enough to be quick, gentle on the API. */
const QR_CONCURRENCY = 4;

/** Runs `fn` over `items` with at most `limit` calls in flight. */
async function eachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function TablesStep({
  workspaceId,
  branchId,
  onDone,
}: {
  workspaceId: string;
  branchId: string;
  onDone: () => void | Promise<void>;
}) {
  const [prefix, setPrefix] = useState("T");
  const [count, setCount] = useState("10");
  const [capacity, setCapacity] = useState("4");
  const { pending, run, err, error, formError, setFieldErrors } = useAction();
  const [qrProgress, setQrProgress] = useState<{ done: number; total: number } | null>(null);
  const n = Number(count);
  const limit = useLimit(workspaceId, "maxTables", {
    adding: Number.isInteger(n) && n > 0 ? n : 1,
  });
  return (
    <StepForm
      title="Add your tables"
      description="Create tables in bulk, for example T1–T10. Each table gets its own secure QR code, ready to print."
      pending={pending}
      submitLabel={Number.isInteger(n) && n > 0 ? `Create ${n} tables` : "Create tables"}
      blockedReason={limit.reason}
      onSkip={() => void onDone()}
      notice={
        <>
          <PlanErrorNotice error={error} workspaceId={workspaceId} />
          {!isPlanError(error) ? <FormError>{formError}</FormError> : null}
          {qrProgress ? (
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              Generating QR codes {qrProgress.done}/{qrProgress.total}
            </p>
          ) : null}
        </>
      }
      onSubmit={async () => {
        const local: Record<string, string[]> = {};
        if (!Number.isInteger(n) || n < 1 || n > 100)
          local.to = ["Enter a whole number from 1 to 100"];
        const seats = Number(capacity);
        if (!Number.isInteger(seats) || seats < 1 || seats > 100)
          local.capacity = ["Enter 1 to 100 seats"];
        if (Object.keys(local).length > 0) {
          setFieldErrors(local);
          return;
        }
        const created = await run(async () => {
          const tables = await api.post<TableDto[]>(`/branches/${branchId}/tables/bulk`, {
            prefix,
            from: 1,
            to: Number.isInteger(n) ? n : 0,
            capacity: Number(capacity),
          });
          // Codes right away, so the first test order needs no extra step. A failure here
          // is not fatal: the print sheet's "Generate missing" covers any table left out.
          setQrProgress({ done: 0, total: tables.length });
          try {
            // One user action: counted as one qr_generated (a key event), with the number made.
            await asOneAction("qr_generated", () =>
              eachLimited(tables, QR_CONCURRENCY, async (t) => {
                await api.post(`/tables/${t.id}/qr`).catch(() => undefined);
                setQrProgress((p) => (p ? { ...p, done: p.done + 1 } : p));
              }),
            );
          } finally {
            setQrProgress(null);
          }
          return tables;
        });
        if (created) await onDone();
      }}
    >
      <div className="grid grid-cols-3 gap-3">
        <FormField label="Prefix" description="Optional" error={err("prefix")}>
          <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </FormField>
        <FormField label="How many" description="1 to 100" required error={err("to")}>
          <Input value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" />
        </FormField>
        <FormField label="Seats each" required error={err("capacity")}>
          <Input
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            inputMode="numeric"
          />
        </FormField>
      </div>
    </StepForm>
  );
}

import { AuthGate } from "@ros/web-core/features/session/auth-gate";

export function OnboardingWizard() {
  return (
    <AuthGate>
      <Wizard />
    </AuthGate>
  );
}
