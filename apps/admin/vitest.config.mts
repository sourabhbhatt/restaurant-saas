import { uiProject } from "../../packages/tooling/vitest.base.mts";

export default uiProject({ name: "admin", include: ["src/**/*.test.{ts,tsx}"] });
