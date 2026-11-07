"use client";

import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@ros/ui/ui/dialog";
import type { RestaurantDto } from "@ros/contracts/tenancy";
import { PlanErrorNotice, usePlanError } from "@ros/web-core/features/subscriptions/limit-notice";

import { useCreateRestaurant } from "./queries";
import { RestaurantForm } from "./restaurant-form";

export function CreateRestaurantDialog({
  workspaceId,
  open,
  onOpenChange,
  onCreated,
}: {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (restaurant: RestaurantDto) => void;
}) {
  const create = useCreateRestaurant(workspaceId);
  const plan = usePlanError(workspaceId);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) plan.clear();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Create restaurant</DialogTitle>
          <DialogDescription>
            A restaurant is a brand or concept with its own menu and branding. You add its branches
            (locations) next.
          </DialogDescription>
        </DialogHeader>
        <RestaurantForm
          workspaceId={workspaceId}
          compact
          submitLabel="Create restaurant"
          notice={<PlanErrorNotice error={plan.error} workspaceId={workspaceId} />}
          onCancel={() => onOpenChange(false)}
          onSubmit={async (values) => {
            plan.clear();
            try {
              const restaurant = await create.mutateAsync(values);
              toast.success(`${restaurant.name} created`);
              onOpenChange(false);
              onCreated?.(restaurant);
            } catch (error) {
              // The server re-checks the plan; if it refuses, say so next to the button.
              if (!plan.capture(error)) throw error;
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
