-- The API connects as ros_runtime and its readiness probe compares the applied
-- migrations with the journal. Without these grants to_regclass() cannot see
-- drizzle.__drizzle_migrations and every migration looks pending (503 not ready).
-- Read-only: the runtime role can never write the migration history.
GRANT USAGE ON SCHEMA drizzle TO ros_runtime;
--> statement-breakpoint
GRANT SELECT ON drizzle.__drizzle_migrations TO ros_runtime;
