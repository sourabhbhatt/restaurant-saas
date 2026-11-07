import { uiProject } from "../../packages/tooling/vitest.base.mts";

export default uiProject({ name: "console", include: ["src/**/*.test.{ts,tsx}"] });
