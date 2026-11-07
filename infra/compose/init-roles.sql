-- Runs once after `migrate` (as the database owner). The migrations create
-- ros_runtime NOLOGIN; the API connects as it so row-level security applies.
-- Invoked with: psql -v pw="$RUNTIME_PASSWORD" -f init-roles.sql
ALTER ROLE ros_runtime LOGIN PASSWORD :'pw';
GRANT CONNECT ON DATABASE :"db" TO ros_runtime;
