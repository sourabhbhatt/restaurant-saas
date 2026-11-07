"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@ros/ui/ui/dialog";
import type { RestaurantDto } from "@ros/contracts/tenancy";

import { handlePlanError } from "./plan-error";
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
  const router = useRouter();
  const create = useCreateRestaurant(workspaceId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New restaurant</DialogTitle>
          <DialogDescription>
            A restaurant has its own menu and branding. You can add branches next.
          </DialogDescription>
        </DialogHeader>
        <RestaurantForm
          workspaceId={workspaceId}
          compact
          submitLabel="Create restaurant"
          onCancel={() => onOpenChange(false)}
          onSubmit={async (values) => {
            try {
              const restaurant = await create.mutateAsync(values);
              toast.success(`${restaurant.name} created`);
              onOpenChange(false);
              onCreated?.(restaurant);
            } catch (error) {
              if (!handlePlanError(error, workspaceId, (href) => router.push(href))) throw error;
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
