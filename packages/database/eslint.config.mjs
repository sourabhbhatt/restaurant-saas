import { baseConfig, restrictImports } from "../tooling/eslint.base.mjs";

export default baseConfig(
  // Repositories implement the application's ports (type-only) and never call services.
  restrictImports([
    {
      group: ["@ros/application", "@ros/application/*", "@ros/adapters", "@ros/adapters/*", "@/*"],
      message:
        "@ros/database must not depend on @ros/application or @ros/adapters at runtime; import port types only.",
    },
  ]),
);
