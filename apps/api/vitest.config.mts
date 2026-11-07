import { serverProject } from "../../packages/tooling/vitest.base.mts";

export default serverProject({
  name: "api",
  include: ["src/**/*.test.ts", "tests/integration/**/*.test.ts"],
});
