# QueueFlow Supabase Database Architecture & Strategy

## Overview

QueueFlow uses PostgreSQL via Supabase as the single authoritative **SOURCE OF TRUTH**.
All tenant data, user profiles, queues, orders, and system logs reside in PostgreSQL.

## Migration Conventions

1. Migrations live in `supabase/migrations/`.
2. Filenames follow timestamp formatting: `YYYYMMDDHHMMSS_description.sql`.
3. Every table MUST enforce Row Level Security (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`).
4. Policies MUST be tenant-isolated via `restaurant_id`.

## Local Development Workflow

To start local Supabase instance:
```bash
npx supabase start
```

To create a new migration:
```bash
npx supabase migration new <migration_name>
```

To apply local migrations:
```bash
npx supabase db reset
```

## Seed Strategy

Local seed files live in `supabase/seed.sql`.
Seed scripts must create baseline platform roles (`SUPER_ADMIN`, `RESTAURANT_ADMIN`, `STAFF`) and dummy test tenants for local manual verification only.
