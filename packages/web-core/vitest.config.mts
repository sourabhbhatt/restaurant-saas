import { defineConfig } from "vitest/config";

import { serverProject, uiProject } from "../tooling/vitest.base.mts";

export default defineConfig({
  test: {
    projects: [
      // Node-only modules: the API proxy and the security headers.
      serverProject({ name: "web-core:node", include: ["src/*.test.ts"] }),
      uiProject({
        name: "web-core:ui",
        include: ["src/**/*.test.tsx", "src/features/**/*.test.ts"],
      }),
    ],
  },
});
