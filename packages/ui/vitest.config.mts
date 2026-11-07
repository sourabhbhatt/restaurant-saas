import { uiProject } from "../tooling/vitest.base.mts";

export default uiProject({ name: "ui", include: ["src/**/*.test.{ts,tsx}"] });
