import { ImageResponse } from "next/og";

import { LogoArtwork } from "@ros/web-core/features/site/seo/brand-images";
import { LOGO } from "@ros/web-core/features/site/seo/structured-data";

/** Square logo for Organization structured data (Google asks for at least 112×112). */
export function GET() {
  return new ImageResponse(<LogoArtwork size={LOGO.size} />, {
    width: LOGO.size,
    height: LOGO.size,
  });
}
