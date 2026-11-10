import { ImageResponse } from "next/og";

import { OgArtwork } from "@ros/web-core/features/site/seo/brand-images";
import { OG_IMAGE } from "@ros/web-core/features/site/seo/page-metadata";

/** Shared social preview image; uses no request data, so it is generated at build time. */
export function GET() {
  return new ImageResponse(<OgArtwork />, { width: OG_IMAGE.width, height: OG_IMAGE.height });
}
