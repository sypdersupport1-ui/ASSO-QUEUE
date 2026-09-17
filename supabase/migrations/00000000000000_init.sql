-- QueueFlow Initial Migration Placeholder
-- Phase 1 Foundation
-- Business tables (restaurants, users, tables, queue, orders, etc.) will be defined in Phase 2.

-- Enable required UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Log migration execution
COMMENT ON DATABASE postgres IS 'QueueFlow Multi-Tenant Restaurant SaaS Database';
