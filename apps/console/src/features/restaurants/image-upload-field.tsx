"use client";

import { ImageIcon, Trash2, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@ros/ui/ui/button";
import { Spinner } from "@ros/ui/ui/spinner";
import { API_BASE, ApiError, errorMessage } from "@ros/api-client";
import { cn } from "@ros/ui/utils";

import { fileUrl } from "./queries";

/** Multipart upload to the workspace upload endpoint (owned by the menu module). */
async function uploadImage(
  workspaceId: string,
  file: File,
  purpose: "logo" | "cover",
): Promise<{ key: string; url: string }> {
  const form = new FormData();
  form.set("file", file);
  form.set("purpose", purpose);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/workspaces/${workspaceId}/uploads`, {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError({
      status: 0,
      code: "NETWORK_ERROR",
      message: "You appear to be offline. Check your connection and try again.",
    });
  }
  const payload = (await res.json().catch(() => null)) as {
    data?: { key: string; url: string };
    error?: { code?: string; message?: string };
  } | null;
  if (!res.ok || !payload?.data) {
    throw new ApiError({
      status: res.status,
      code: payload?.error?.code ?? "REQUEST_FAILED",
      message:
        res.status === 404
          ? "Image uploads aren't available yet. You can add an image later."
          : (payload?.error?.message ?? `Upload failed (${res.status})`),
    });
  }
  return payload.data;
}

const MAX_BYTES = 2 * 1024 * 1024;

export function ImageUploadField({
  workspaceId,
  purpose,
  label,
  value,
  onChange,
  disabled,
}: {
  workspaceId: string;
  purpose: "logo" | "cover";
  label: string;
  value: string | null | undefined;
  onChange: (key: string | null) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const src = preview ?? fileUrl(value);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      toast.error("Use a PNG, JPEG or WebP image");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Images must be 2 MB or smaller");
      return;
    }
    setUploading(true);
    try {
      const result = await uploadImage(workspaceId, file, purpose);
      setPreview(result.url);
      onChange(result.key);
      toast.success(`${label} uploaded`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="grid gap-2">
      <span id={`${id}-label`} className="text-sm leading-none font-medium">
        {label}
      </span>
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted text-muted-foreground",
            purpose === "logo" ? "size-16" : "h-16 w-28",
          )}
        >
          {src ? (
            // Stored objects are served by our API; next/image optimisation is unnecessary here.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" className="size-full object-cover" />
          ) : (
            <ImageIcon className="size-5" aria-hidden />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            id={id}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            aria-labelledby={`${id}-label`}
            disabled={disabled || uploading}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || uploading}
            onClick={() => input.current?.click()}
          >
            {uploading ? <Spinner decorative /> : <Upload aria-hidden />}
            {value ? "Replace" : "Upload"}
          </Button>
          {value ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || uploading}
              onClick={() => {
                setPreview(null);
                onChange(null);
              }}
            >
              <Trash2 aria-hidden /> Remove
            </Button>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">PNG, JPEG or WebP, up to 2 MB.</p>
    </div>
  );
}
