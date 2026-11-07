import { serverProject } from "../tooling/vitest.base.mts";

export default serverProject({ name: "database", include: ["src/**/*.test.ts"] });
