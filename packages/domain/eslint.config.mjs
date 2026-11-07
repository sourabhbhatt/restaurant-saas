import { baseConfig, restrictImports } from "../tooling/eslint.base.mjs";

export default baseConfig(
  // Pure business rules: no I/O, no framework, nothing from other packages.
  restrictImports([
    {
      group: [
        "@ros/*",
        "@/*",
        "next",
        "next/*",
        "react",
        "react/*",
        "drizzle-orm",
        "drizzle-orm/*",
      ],
      message: "@ros/domain depends on nothing but zod and itself.",
      allowTypeImports: false,
    },
  ]),
);
