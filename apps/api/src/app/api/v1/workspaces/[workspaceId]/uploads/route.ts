import { z } from "zod";

import { MAX_UPLOAD_BYTES } from "@ros/contracts/menu";
import { DomainError } from "@ros/domain/shared/errors";
import { uploadService } from "@/composition/menu";
import { route } from "@ros/application/http/route";

const params = z.object({ workspaceId: z.uuid() });

/**
 * Multipart upload: `file`, `purpose` (menu_item | logo | cover), optional
 * `restaurantId`. The body is read here (route() only parses JSON bodies).
 */
export const POST = route(
  {
    auth: "user",
    params,
    rateLimit: { name: "uploads", limit: 60, windowMs: 10 * 60_000 },
  },
  async ({ req, actor, params, meta, c }) => {
    const type = req.headers.get("content-type") ?? "";
    if (!type.includes("multipart/form-data")) {
      throw new DomainError("BAD_REQUEST", "Expected a multipart/form-data body");
    }
    const declared = Number(req.headers.get("content-length") ?? "0");
    // Multipart framing adds a little; anything far above the limit is rejected unread.
    if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
      throw new DomainError("VALIDATION_FAILED", "Images must be 2 MB or smaller", {
        fieldErrors: { file: ["Images must be 2 MB or smaller"] },
      });
    }
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new DomainError("BAD_REQUEST", "Malformed multipart body");
    }
    const purpose = form.get("purpose");
    const restaurantId = form.get("restaurantId");
    const result = await uploadService(c).upload(
      actor,
      params.workspaceId,
      {
        file: form.get("file"),
        purpose: typeof purpose === "string" ? purpose : null,
        restaurantId: typeof restaurantId === "string" && restaurantId ? restaurantId : null,
      },
      meta,
    );
    return { status: 201, data: result };
  },
);
