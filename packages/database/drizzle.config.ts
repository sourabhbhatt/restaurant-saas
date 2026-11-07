import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/providers/postgres/schema/index.ts",
  out: "./src/providers/postgres/migrations",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://restaurantos:restaurantos@localhost:5432/restaurantos_dev",
  },
  strict: true,
  verbose: true,
});
