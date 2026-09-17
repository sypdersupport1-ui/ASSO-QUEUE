-- QueueFlow Phase 2 Migration: Database Schema, RLS, Helper Functions, and Indexes
-- Target Database: PostgreSQL / Supabase

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. CORE TABLES
-- ============================================================================

-- RESTAURANTS
CREATE TABLE IF NOT EXISTS public.restaurants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    country TEXT,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
    logo_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ
);

-- USER PROFILES (Linked to auth.users)
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RESTAURANT MEMBERSHIPS / ROLES
CREATE TABLE IF NOT EXISTS public.restaurant_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN', 'RESTAURANT_ADMIN', 'STAFF')),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_user_restaurant_role UNIQUE (user_id, restaurant_id, role)
);

-- RESTAURANT ZONES
CREATE TABLE IF NOT EXISTS public.restaurant_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_restaurant_zone_name UNIQUE (restaurant_id, name)
);

-- RESTAURANT TABLES
CREATE TABLE IF NOT EXISTS public.restaurant_tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    zone_id UUID REFERENCES public.restaurant_zones(id) ON DELETE SET NULL,
    table_number TEXT NOT NULL,
    capacity INT NOT NULL DEFAULT 2 CHECK (capacity > 0),
    status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'OCCUPIED', 'CLEANING', 'BLOCKED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_restaurant_table_number UNIQUE (restaurant_id, table_number)
);

-- QUEUE ENTRIES
CREATE TABLE IF NOT EXISTS public.queue_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    party_size INT NOT NULL DEFAULT 1 CHECK (party_size > 0),
    queue_number INT NOT NULL,
    status TEXT NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING', 'NOTIFIED', 'CONFIRMED', 'ARRIVED', 'SEATED', 'COMPLETED', 'CANCELLED', 'REMOVED', 'SKIPPED', 'NO_SHOW')),
    token_hash TEXT,
    notified_at TIMESTAMPTZ,
    seated_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- QUEUE EVENTS (Append-Only Lifecycle History)
CREATE TABLE IF NOT EXISTS public.queue_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    queue_entry_id UUID NOT NULL REFERENCES public.queue_entries(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    actor_user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- MENU CATEGORIES
CREATE TABLE IF NOT EXISTS public.menu_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    sort_order INT NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_restaurant_category_name UNIQUE (restaurant_id, name)
);

-- MENU ITEMS
CREATE TABLE IF NOT EXISTS public.menu_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    category_id UUID REFERENCES public.menu_categories(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    preparation_time_minutes INT NOT NULL DEFAULT 15 CHECK (preparation_time_minutes >= 0),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    available BOOLEAN NOT NULL DEFAULT TRUE,
    image_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ORDERS
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    queue_entry_id UUID REFERENCES public.queue_entries(id) ON DELETE SET NULL,
    table_id UUID REFERENCES public.restaurant_tables(id) ON DELETE SET NULL,
    order_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'IN_PREPARATION', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED')),
    payment_status TEXT NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID', 'PARTIAL', 'PAID', 'REFUNDED')),
    subtotal NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (subtotal >= 0),
    tax NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (tax >= 0),
    total NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (total >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ORDER ITEMS (Price snapshot preserved at ordering time)
CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    menu_item_id UUID REFERENCES public.menu_items(id) ON DELETE SET NULL,
    name_snapshot TEXT NOT NULL,
    unit_price_snapshot NUMERIC(10, 2) NOT NULL CHECK (unit_price_snapshot >= 0),
    quantity INT NOT NULL CHECK (quantity > 0),
    total_price NUMERIC(10, 2) NOT NULL CHECK (total_price >= 0),
    special_instructions TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- PAYMENTS
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
    amount NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED')),
    provider TEXT NOT NULL,
    provider_reference TEXT,
    idempotency_key TEXT UNIQUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- NOTIFICATIONS
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    queue_entry_id UUID REFERENCES public.queue_entries(id) ON DELETE SET NULL,
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
    channel TEXT NOT NULL CHECK (channel IN ('SMS', 'WHATSAPP', 'EMAIL')),
    notification_type TEXT NOT NULL,
    recipient TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'DELIVERED')),
    provider TEXT NOT NULL,
    provider_message_id TEXT,
    idempotency_key TEXT,
    message TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- AUDIT LOGS (Append-Only Administrative Audit Log)
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 2. INDEXING
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_memberships_user ON public.restaurant_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_restaurant ON public.restaurant_memberships(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_zones_restaurant ON public.restaurant_zones(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_tables_restaurant_status ON public.restaurant_tables(restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_queue_restaurant_status ON public.queue_entries(restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_queue_token_hash ON public.queue_entries(token_hash);
CREATE INDEX IF NOT EXISTS idx_queue_events_entry ON public.queue_events(queue_entry_id);
CREATE INDEX IF NOT EXISTS idx_menu_categories_restaurant ON public.menu_categories(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant_cat ON public.menu_items(restaurant_id, category_id);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_status ON public.orders(restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_order ON public.payments(order_id);
CREATE INDEX IF NOT EXISTS idx_notifications_restaurant ON public.notifications(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_restaurant_time ON public.audit_logs(restaurant_id, created_at DESC);

-- ============================================================================
-- 3. NON-RECURSIVE SECURITY HELPER FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_current_user_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.restaurant_memberships
    WHERE user_id = p_user_id
      AND role = 'SUPER_ADMIN'
      AND status = 'ACTIVE'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_user_restaurant_ids(p_user_id UUID)
RETURNS TABLE (restaurant_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT restaurant_id
  FROM public.restaurant_memberships
  WHERE user_id = p_user_id
    AND status = 'ACTIVE'
    AND restaurant_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.has_restaurant_role(p_user_id UUID, p_restaurant_id UUID, p_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.restaurant_memberships
    WHERE user_id = p_user_id
      AND (restaurant_id = p_restaurant_id OR role = 'SUPER_ADMIN')
      AND role = ANY(p_roles)
      AND status = 'ACTIVE'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_super_admin(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_restaurant_ids(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_restaurant_role(UUID, UUID, TEXT[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_current_user_id() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_restaurant_ids(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_restaurant_role(UUID, UUID, TEXT[]) TO authenticated, service_role;

-- ============================================================================
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- RESTAURANTS RLS
DROP POLICY IF EXISTS "Super Admins can perform all actions on restaurants" ON public.restaurants;
CREATE POLICY "Super Admins can perform all actions on restaurants"
  ON public.restaurants
  FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Restaurant Admins and Staff can view assigned restaurant" ON public.restaurants;
CREATE POLICY "Restaurant Admins and Staff can view assigned restaurant"
  ON public.restaurants
  FOR SELECT
  TO authenticated
  USING (id IN (SELECT public.get_user_restaurant_ids(auth.uid())));

-- USER PROFILES RLS
DROP POLICY IF EXISTS "Users can view their own profile" ON public.user_profiles;
CREATE POLICY "Users can view their own profile"
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can update their own profile" ON public.user_profiles;
CREATE POLICY "Users can update their own profile"
  ON public.user_profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Allow system insert on user_profiles" ON public.user_profiles;
CREATE POLICY "Allow system insert on user_profiles"
  ON public.user_profiles
  FOR INSERT
  TO authenticated, service_role
  WITH CHECK (true);

-- RESTAURANT MEMBERSHIPS RLS
DROP POLICY IF EXISTS "Super Admins can manage all memberships" ON public.restaurant_memberships;
CREATE POLICY "Super Admins can manage all memberships"
  ON public.restaurant_memberships
  FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can view their own memberships" ON public.restaurant_memberships;
CREATE POLICY "Users can view their own memberships"
  ON public.restaurant_memberships
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Restaurant Admins can view memberships for their restaurant" ON public.restaurant_memberships;
CREATE POLICY "Restaurant Admins can view memberships for their restaurant"
  ON public.restaurant_memberships
  FOR SELECT
  TO authenticated
  USING (restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())));

-- RESTAURANT ZONES
DROP POLICY IF EXISTS "Tenant isolation for restaurant_zones" ON public.restaurant_zones;
CREATE POLICY "Tenant isolation for restaurant_zones"
  ON public.restaurant_zones FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())))
  WITH CHECK (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())));

-- RESTAURANT TABLES
DROP POLICY IF EXISTS "Tenant isolation for restaurant_tables" ON public.restaurant_tables;
CREATE POLICY "Tenant isolation for restaurant_tables"
  ON public.restaurant_tables FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())))
  WITH CHECK (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())));

-- QUEUE ENTRIES
DROP POLICY IF EXISTS "Tenant isolation for queue_entries" ON public.queue_entries;
CREATE POLICY "Tenant isolation for queue_entries"
  ON public.queue_entries FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())))
  WITH CHECK (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())));

-- QUEUE EVENTS
DROP POLICY IF EXISTS "Tenant select for queue_events" ON public.queue_events;
CREATE POLICY "Tenant select for queue_events"
  ON public.queue_events FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())));

DROP POLICY IF EXISTS "Tenant insert for queue_events" ON public.queue_events;
CREATE POLICY "Tenant insert for queue_events"
  ON public.queue_events FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())));

-- MENU CATEGORIES
DROP POLICY IF EXISTS "Tenant isolation for menu_categories" ON public.menu_categories;
CREATE POLICY "Tenant isolation for menu_categories"
  ON public.menu_categories FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())))
  WITH CHECK (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())));

-- MENU ITEMS
DROP POLICY IF EXISTS "Tenant isolation for menu_items" ON public.menu_items;
CREATE POLICY "Tenant isolation for menu_items"
  ON public.menu_items FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())))
  WITH CHECK (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())));

-- ORDERS
DROP POLICY IF EXISTS "Tenant isolation for orders" ON public.orders;
CREATE POLICY "Tenant isolation for orders"
  ON public.orders FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())))
  WITH CHECK (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())));

-- ORDER ITEMS
DROP POLICY IF EXISTS "Tenant isolation for order_items" ON public.order_items;
CREATE POLICY "Tenant isolation for order_items"
  ON public.order_items FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())))
  WITH CHECK (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())));

-- PAYMENTS
DROP POLICY IF EXISTS "Tenant isolation for payments" ON public.payments;
CREATE POLICY "Tenant isolation for payments"
  ON public.payments FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())))
  WITH CHECK (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())));

-- NOTIFICATIONS
DROP POLICY IF EXISTS "Tenant isolation for notifications" ON public.notifications;
CREATE POLICY "Tenant isolation for notifications"
  ON public.notifications FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())))
  WITH CHECK (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())));

-- AUDIT LOGS
DROP POLICY IF EXISTS "Tenant select for audit_logs" ON public.audit_logs;
CREATE POLICY "Tenant select for audit_logs"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())));

DROP POLICY IF EXISTS "Tenant insert for audit_logs" ON public.audit_logs;
CREATE POLICY "Tenant insert for audit_logs"
  ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())));
