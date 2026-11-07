"use client";

import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@ros/ui/ui/dialog";
import type { BranchDto } from "@ros/contracts/tenancy";
import { isCurrencyCode } from "@ros/domain/shared/money";
import { PlanErrorNotice, usePlanError } from "@ros/web-core/features/subscriptions/limit-notice";
import { BranchForm } from "@/features/branches/branch-form";

import { useCreateBranch } from "./queries";

export function CreateBranchDialog({
  workspaceId,
  restaurant,
  defaultCurrency,
  open,
  onOpenChange,
  onCreated,
}: {
  workspaceId: string;
  restaurant: { id: string; name: string } | null;
  defaultCurrency?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (branch: BranchDto) => void;
}) {
  const create = useCreateBranch(workspaceId);
  const plan = usePlanError(workspaceId);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) plan.clear();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add branch{restaurant ? ` to ${restaurant.name}` : ""}</DialogTitle>
          <DialogDescription>
            A branch is a physical location. Each branch has its own tables, staff, orders, bills
            and settings, and shares the restaurant&apos;s menu.
          </DialogDescription>
        </DialogHeader>
        {restaurant ? (
          <BranchForm
            key={restaurant.id}
            showHours={false}
            defaultValues={
              defaultCurrency && isCurrencyCode(defaultCurrency)
                ? { currency: defaultCurrency }
                : undefined
            }
            submitLabel="Create branch"
            notice={<PlanErrorNotice error={plan.error} workspaceId={workspaceId} />}
            onCancel={() => onOpenChange(false)}
            onSubmit={async (data) => {
              plan.clear();
              try {
                const branch = await create.mutateAsync({ restaurantId: restaurant.id, data });
                toast.success(`${branch.name} created`, {
                  description: "Set business hours and taxes in the branch settings.",
                });
                onOpenChange(false);
                onCreated?.(branch);
              } catch (error) {
                if (!plan.capture(error)) throw error;
              }
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
