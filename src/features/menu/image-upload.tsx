"use client";

import { ImageIcon, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MAX_UPLOAD_BYTES, UPLOAD_CONTENT_TYPES, type UploadPurpose } from "@ros/contracts/menu";
import { errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import { uploadImage } from "./queries";

/** Image picker with preview: uploads first, then reports the stored key. */
export function ImageUpload({
  workspaceId,
  restaurantId,
  purpose,
  previewUrl,
  onChange,
  disabled,
  invalid,
}: {
  workspaceId: string;
  restaurantId?: string;
  purpose: UploadPurpose;
  previewUrl: string | null;
  onChange: (value: { key: string; url: string } | null) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle(file: File) {
    setError(null);
    if (!(UPLOAD_CONTENT_TYPES as readonly string[]).includes(file.type)) {
      setError("Choose a PNG, JPEG or WebP image.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("Images must be 2 MB or smaller.");
      return;
    }
    setPending(true);
    try {
      const result = await uploadImage({ workspaceId, restaurantId, purpose, file });
      onChange(result);
      toast.success("Image uploaded");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-4">
        <div
          className={cn(
            "flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted",
            (invalid || error) && "border-destructive",
          )}
        >
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- user uploads served from our files route
            <img src={previewUrl} alt="Item photo preview" className="size-full object-cover" />
          ) : (
            <ImageIcon className="size-8 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={UPLOAD_CONTENT_TYPES.join(",")}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handle(file);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || pending}
            onClick={() => inputRef.current?.click()}
          >
            {pending ? <Spinner decorative /> : <Upload aria-hidden />}
            {previewUrl ? "Replace photo" : "Upload photo"}
          </Button>
          {previewUrl && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || pending}
              onClick={() => onChange(null)}
            >
              <Trash2 aria-hidden /> Remove
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">PNG, JPEG or WebP, up to 2 MB.</p>
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
