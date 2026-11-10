-- Reverts 0009_perf_indexes.
DROP INDEX IF EXISTS "orders_branch_cancelled_recent_idx";
DROP INDEX IF EXISTS "orders_branch_done_recent_idx";
DROP INDEX IF EXISTS "bills_branch_open_idx";
