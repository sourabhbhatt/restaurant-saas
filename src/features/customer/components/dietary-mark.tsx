import { cn } from "@/lib/utils";

const LABELS: Record<string, string> = {
  VEG: "Vegetarian",
  VEGAN: "Vegan",
  NON_VEG: "Non-vegetarian",
  EGG: "Contains egg",
};

/** Indian-menu style dietary marker: outlined square with a coloured dot. */
export function DietaryMark({ dietary, className }: { dietary: string | null; className?: string }) {
  if (!dietary || !LABELS[dietary]) return null;
  const tone =
    dietary === "NON_VEG"
      ? "border-destructive text-destructive"
      : dietary === "EGG"
        ? "border-warning text-warning"
        : "border-success text-success";
  return (
    <span
      role="img"
      aria-label={LABELS[dietary]}
      title={LABELS[dietary]}
      className={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border-[1.5px]",
        tone,
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
    </span>
  );
}
