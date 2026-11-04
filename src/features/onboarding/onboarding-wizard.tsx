"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { PageSkeleton } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import type { BranchDto, RestaurantDto } from "@/contracts/tenancy";
import type { WorkspaceDto } from "@/contracts/workspaces";
import { toMinor } from "@/domain/shared/money";
import { sessionKeys, useMe } from "@/features/session/queries";
import { api } from "@/lib/api-client";
import { useAction } from "@/lib/use-action";

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
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    props.onSubmit();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {props.children}
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={props.pending}>
              {props.pending ? "Saving…" : props.submitLabel}
            </Button>
            {props.onSkip ? (
              <Button type="button" variant="ghost" onClick={props.onSkip} disabled={props.pending}>
                Skip for now
              </Button>
            ) : null}
          </div>
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
            await qc.invalidateQueries({ queryKey: sessionKeys.structure(progress.workspaceId!) });
            setStep("menu");
          }}
        />
      )}
      {activeStep === "menu" && progress.restaurantId && progress.workspaceId && (
        <MenuStep
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
          branchId={progress.branchId}
          onDone={async () => {
            await saveProgress(progress.workspaceId!, { completedStep: "tables" });
            setStep("done");
          }}
        />
      )}
      {activeStep === "done" && progress.branchId && progress.workspaceId && (
        <Card>
          <CardHeader>
            <CardTitle>You&apos;re all set 🎉</CardTitle>
            <CardDescription>
              Next: generate and print QR codes for your tables, add more menu items and invite your
              staff.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 sm:flex-row">
            <Button
              onClick={async () => {
                await saveProgress(progress.workspaceId!, { completedStep: "done", dismiss: true });
                router.push(`/app/b/${progress.branchId}/tables`);
              }}
            >
              Open tables &amp; QR codes
            </Button>
            <Button asChild variant="outline">
              <Link href={`/app/b/${progress.branchId}`}>Go to dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function WorkspaceStep({ onDone }: { onDone: (ws: WorkspaceDto) => void | Promise<void> }) {
  const [name, setName] = useState("");
  const { pending, run, err } = useAction();
  return (
    <StepForm
      title="Name your business"
      description="This is your workspace. You can run several restaurants and branches inside it. Your 30-day free trial starts now."
      pending={pending}
      submitLabel="Create workspace"
      onSubmit={async () => {
        const ws = await run(() => api.post<WorkspaceDto>("/workspaces", { name }));
        if (ws) await onDone(ws);
      }}
    >
      <FormField label="Business name" required error={err("name")}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Saffron Hospitality"
          autoFocus
        />
      </FormField>
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
  const { pending, run, err } = useAction();
  return (
    <StepForm
      title="Your first restaurant"
      description="Add the restaurant and its first branch. Tax, hours and address can be refined later."
      pending={pending}
      submitLabel="Continue"
      onSubmit={async () => {
        const result = await run(async () => {
          const r = await api.post<RestaurantDto>(`/workspaces/${workspaceId}/restaurants`, {
            name: restaurant,
          });
          const b = await api.post<BranchDto>(`/restaurants/${r.id}/branches`, {
            name: branch,
            city: city || undefined,
          });
          return { r, b };
        });
        if (result) await onDone(result.r.id, result.b.id);
      }}
    >
      <FormField label="Restaurant name" required error={err("name")}>
        <Input value={restaurant} onChange={(e) => setRestaurant(e.target.value)} autoFocus />
      </FormField>
      <FormField label="First branch name" required error={err("name")}>
        <Input value={branch} onChange={(e) => setBranch(e.target.value)} />
      </FormField>
      <FormField label="City" error={err("city")}>
        <Input value={city} onChange={(e) => setCity(e.target.value)} />
      </FormField>
    </StepForm>
  );
}

function MenuStep({
  restaurantId,
  categoryId,
  onCategory,
  onDone,
}: {
  restaurantId: string;
  categoryId: string | null;
  onCategory: (id: string) => void;
  onDone: () => void | Promise<void>;
}) {
  const [category, setCategory] = useState("Mains");
  const [item, setItem] = useState("");
  const [price, setPrice] = useState("");
  const [dietary, setDietary] = useState<"VEG" | "NON_VEG">("VEG");
  const { pending, run, err } = useAction();
  return (
    <StepForm
      title="Add your first dish"
      description="Start with one category and one item. Variants, add-ons, photos and the rest of the menu are managed on the Menu page."
      pending={pending}
      submitLabel="Continue"
      onSkip={() => void onDone()}
      onSubmit={async () => {
        const amount = Number(price);
        if (!Number.isFinite(amount) || amount < 0) {
          toast.error("Enter a valid price");
          return;
        }
        const ok = await run(async () => {
          let cid = categoryId;
          if (!cid) {
            const c = await api.post<{ id: string }>(
              `/restaurants/${restaurantId}/menu/categories`,
              {
                name: category,
              },
            );
            cid = c.id;
            onCategory(cid);
          }
          return api.post(`/restaurants/${restaurantId}/menu/items`, {
            categoryId: cid,
            name: item,
            price: toMinor(amount),
            dietary,
            prepTimeMinutes: 15,
            allergens: [],
          });
        });
        if (ok) await onDone();
      }}
    >
      <FormField label="Category" required error={err("name")}>
        <Input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          disabled={Boolean(categoryId)}
        />
      </FormField>
      <FormField label="Item name" required error={err("name")}>
        <Input value={item} onChange={(e) => setItem(e.target.value)} placeholder="Paneer Tikka" />
      </FormField>
      <FormField label="Price" required error={err("price")}>
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

function TablesStep({
  branchId,
  onDone,
}: {
  branchId: string;
  onDone: () => void | Promise<void>;
}) {
  const [prefix, setPrefix] = useState("T");
  const [count, setCount] = useState("10");
  const [capacity, setCapacity] = useState("4");
  const { pending, run, err } = useAction();
  return (
    <StepForm
      title="Add your tables"
      description="Create tables in bulk, for example T1–T10. Each table gets its own secure QR code on the next screen."
      pending={pending}
      submitLabel="Create tables"
      onSkip={() => void onDone()}
      onSubmit={async () => {
        const n = Number(count);
        const ok = await run(() =>
          api.post(`/branches/${branchId}/tables/bulk`, {
            prefix,
            from: 1,
            to: Number.isInteger(n) ? n : 0,
            capacity: Number(capacity),
          }),
        );
        if (ok) await onDone();
      }}
    >
      <div className="grid grid-cols-3 gap-3">
        <FormField label="Prefix" error={err("prefix")}>
          <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </FormField>
        <FormField label="How many" required error={err("to")}>
          <Input value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" />
        </FormField>
        <FormField label="Seats each" error={err("capacity")}>
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

import { AuthGate } from "@/features/session/auth-gate";

export function OnboardingWizard() {
  return (
    <AuthGate>
      <Wizard />
    </AuthGate>
  );
}
