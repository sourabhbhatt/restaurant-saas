import { baseConfig, restrictImports } from "../tooling/eslint.base.mjs";

export default baseConfig(
  // Application code depends on ports only (spec §4, rule 3): the database
  // transaction interface and the adapters' interface modules, never a provider.
  restrictImports([
    {
      group: [
        "@ros/database/providers",
        "@ros/database/providers/**",
        "@ros/adapters/*/providers",
        "@ros/adapters/*/providers/**",
        "@ros/adapters/logging/**",
        "@ros/adapters/payments/**",
        "@/*",
      ],
      message:
        "@ros/application imports ports only; providers are wired in apps/api/src/composition.",
      // The Container port names the Drizzle executor type; types are erased at runtime.
      allowTypeImports: true,
    },
  ]),
);
