import { uiProject } from "../../packages/tooling/vitest.base.mts";

export default uiProject({ name: "ops", include: ["src/**/*.test.{ts,tsx}"] });
