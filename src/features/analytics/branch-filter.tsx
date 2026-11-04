"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspaceStructure } from "@/features/session/queries";

export interface BranchFilterValue {
  restaurantId?: string;
  branchId?: string;
}

export interface BranchFilterProps {
  workspaceId: string;
  value: BranchFilterValue;
  onChange: (value: BranchFilterValue) => void;
  className?: string;
}

/** "All branches", a whole restaurant, or one branch — from the restaurants the user can see. */
export function BranchFilter({ workspaceId, value, onChange, className }: BranchFilterProps) {
  const structure = useWorkspaceStructure(workspaceId);
  const restaurants = structure.data?.restaurants ?? [];
  const current = value.branchId
    ? `b:${value.branchId}`
    : value.restaurantId
      ? `r:${value.restaurantId}`
      : "all";

  function change(v: string) {
    if (v === "all") onChange({});
    else if (v.startsWith("r:")) onChange({ restaurantId: v.slice(2) });
    else onChange({ branchId: v.slice(2) });
  }

  return (
    <Select value={current} onValueChange={change} disabled={structure.isPending}>
      <SelectTrigger aria-label="Branch" className={className ?? "w-full sm:w-64"}>
        <SelectValue placeholder="All branches" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All branches</SelectItem>
        {restaurants.map((r) => (
          <SelectGroup key={r.id}>
            <SelectLabel>{r.name}</SelectLabel>
            {r.branches.length > 1 && <SelectItem value={`r:${r.id}`}>All of {r.name}</SelectItem>}
            {r.branches.map((b) => (
              <SelectItem key={b.id} value={`b:${b.id}`}>
                {b.name}
                {b.city ? ` · ${b.city}` : ""}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
