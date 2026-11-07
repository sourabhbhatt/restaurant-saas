"use client";

import { RouteError } from "@ros/web-core/route-error";

export default function ErrorPage(props: { error: unknown; retry: () => void }) {
  return <RouteError {...props} homeLabel="Go to the homepage" />;
}
