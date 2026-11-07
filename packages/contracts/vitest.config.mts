import { serverProject } from "../tooling/vitest.base.mts";

export default serverProject({ name: "contracts", include: ["src/**/*.test.ts"] });
