"use client";

import * as React from "react";
import { SearchIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type SearchInputProps = Omit<React.ComponentProps<"input">, "type" | "value" | "defaultValue"> & {
  value?: string;
  defaultValue?: string;
  /** Called with the new string value on every change, including clear. */
  onValueChange?: (value: string) => void;
  /** Called after the clear button (or Escape) empties the field. */
  onClear?: () => void;
  clearLabel?: string;
  containerClassName?: string;
};

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as React.RefObject<T | null>).current = value;
}

/** Text input with a leading search icon and a clear button. Controlled or uncontrolled. */
function SearchInput({
  value,
  defaultValue,
  onChange,
  onValueChange,
  onClear,
  onKeyDown,
  clearLabel = "Clear search",
  className,
  containerClassName,
  disabled,
  ref,
  ...props
}: SearchInputProps) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [innerValue, setInnerValue] = React.useState(defaultValue ?? "");
  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : innerValue;

  const setRefs = React.useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node;
      assignRef(ref, node);
    },
    [ref],
  );

  const clear = () => {
    if (!isControlled) setInnerValue("");
    onValueChange?.("");
    onClear?.();
    inputRef.current?.focus();
  };

  return (
    <div
      data-slot="search-input"
      className={cn("relative flex w-full items-center", containerClassName)}
    >
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
      />
      <input
        ref={setRefs}
        type="search"
        data-slot="input"
        value={currentValue}
        disabled={disabled}
        onChange={(event) => {
          if (!isControlled) setInnerValue(event.target.value);
          onChange?.(event);
          onValueChange?.(event.target.value);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented && event.key === "Escape" && currentValue !== "") {
            event.preventDefault();
            clear();
          }
        }}
        className={cn(
          "flex h-10 w-full min-w-0 rounded-md border border-input bg-transparent py-1 pr-10 pl-9 text-base shadow-xs outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 motion-safe:transition-[color,box-shadow] sm:h-9 md:text-sm dark:bg-input/30",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
          "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
          "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none",
          className,
        )}
        {...props}
      />
      {currentValue !== "" && !disabled && (
        <button
          type="button"
          onClick={clear}
          aria-label={clearLabel}
          className="absolute right-1 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:size-7"
        >
          <XIcon className="size-4" />
        </button>
      )}
    </div>
  );
}

export { SearchInput };
export type { SearchInputProps };
