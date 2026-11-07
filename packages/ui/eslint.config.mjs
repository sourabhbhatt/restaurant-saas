import { baseConfig, restrictImports } from "../tooling/eslint.base.mjs";

export default baseConfig(
  // The design system depends on no other workspace package.
  restrictImports([
    {
      group: ["@ros/*", "@/*"],
      message: "@ros/ui is the bottom of the frontend stack; it imports no @ros package.",
      allowTypeImports: false,
    },
  ]),
);
