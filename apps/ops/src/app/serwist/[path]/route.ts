import { serwistRoute } from "@ros/web-core/serwist-route";

// Only GET and generateStaticParams are re-exported. Serwist also returns
// `dynamic`, `dynamicParams` and `revalidate`, but those route segment options
// are rejected when `cacheComponents` is enabled. Without them the handler is
// still prerendered at build time because it reads no request-time data.
export const { GET, generateStaticParams } = serwistRoute();
