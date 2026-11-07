import { serverProject } from "../tooling/vitest.base.mts";

export default serverProject({ name: "application", include: ["src/**/*.test.ts"] });
