"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BranchDto } from "@ros/contracts/tenancy";
import { isCurrencyCode } from "@ros/domain/shared/money";
import { BranchForm } from "@/features/branches/branch-form";

import { handlePlanError } from "./plan-error";
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
  const router = useRouter();
  const create = useCreateBranch(workspaceId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New branch{restaurant ? ` for ${restaurant.name}` : ""}</DialogTitle>
          <DialogDescription>
            Each branch has its own tables, staff, orders and billing settings.
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
            onCancel={() => onOpenChange(false)}
            onSubmit={async (data) => {
              try {
                const branch = await create.mutateAsync({ restaurantId: restaurant.id, data });
                toast.success(`${branch.name} created`, {
                  description: "Set business hours and taxes in the branch settings.",
                });
                onOpenChange(false);
                onCreated?.(branch);
              } catch (error) {
                if (!handlePlanError(error, workspaceId, (href) => router.push(href))) throw error;
              }
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
