import { baseConfig, restrictImports } from "../tooling/eslint.base.mjs";

export default baseConfig(
  restrictImports([
    {
      group: ["@ros/*", "!@ros/contracts", "!@ros/contracts/*", "@/*"],
      message:
        "@ros/api-client is a plain fetch wrapper; it may only share types with @ros/contracts.",
    },
  ]),
);
