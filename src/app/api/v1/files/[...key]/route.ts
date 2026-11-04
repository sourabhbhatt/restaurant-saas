import { z } from "zod";

import { notFound } from "@/domain/shared/errors";
import { uploadService } from "@/server/composition/menu";
import { route } from "@/server/http/route";

const params = z.object({ key: z.array(z.string().max(200)).min(1).max(8) });

/**
 * Serves stored objects. Files are public-by-key: keys contain a random UUID
 * and are unguessable, so no session is required (menu images are shown to
 * anonymous QR guests). Only sniffed raster images are ever stored.
 */
export const GET = route({ auth: "public", params }, async ({ params, c }) => {
  const object = await uploadService(c).read(params.key.join("/"));
  if (!object) throw notFound("File");
  return new Response(object.body as BodyInit, {
    status: 200,
    headers: {
      "content-type": object.contentType,
      "content-length": String(object.body.byteLength),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
});
