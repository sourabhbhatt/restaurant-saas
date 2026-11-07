import { serverProject } from "../tooling/vitest.base.mts";

export default serverProject({ name: "domain", include: ["src/**/*.test.ts"] });
