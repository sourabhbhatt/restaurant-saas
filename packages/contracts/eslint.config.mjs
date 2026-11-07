import { baseConfig, restrictImports } from "../tooling/eslint.base.mjs";

export default baseConfig(
  restrictImports([
    {
      group: ["@ros/*", "!@ros/domain", "!@ros/domain/*", "@/*"],
      message: "@ros/contracts depends only on @ros/domain and zod.",
      allowTypeImports: false,
    },
  ]),
);
