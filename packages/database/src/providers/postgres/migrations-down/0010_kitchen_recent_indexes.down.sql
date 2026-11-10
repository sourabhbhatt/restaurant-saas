-- Reverts 0010_kitchen_recent_indexes.
DROP INDEX IF EXISTS "orders_branch_cancelled_at_idx";
DROP INDEX IF EXISTS "orders_branch_done_recent_idx";
