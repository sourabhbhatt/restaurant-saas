import { baseConfig, restrictImports } from "../tooling/eslint.base.mjs";

export default baseConfig(
  // Providers implement the application's ports (type-only) and never call services.
  restrictImports([
    {
      group: ["@ros/application", "@ros/application/*", "@/*"],
      message:
        "@ros/adapters must not depend on @ros/application at runtime; import its port types only.",
    },
  ]),
);
