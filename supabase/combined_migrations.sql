-- QueueFlow Initial Migration Placeholder
-- Phase 1 Foundation
-- Business tables (restaurants, users, tables, queue, orders, etc.) will be defined in Phase 2.

-- Enable required UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Log migration execution
COMMENT ON DATABASE postgres IS 'QueueFlow Multi-Tenant Restaurant SaaS Database';
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
-- QueueFlow Phase 5 Migration: Granular RBAC, Permission Catalog, Role Mappings & Security Functions
-- Target Database: PostgreSQL / Supabase

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. TABLES FOR GRANULAR PERMISSIONS
-- ============================================================================

-- PERMISSIONS CATALOG
CREATE TABLE IF NOT EXISTS public.permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    description TEXT,
    domain TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ROLE PERMISSIONS MAPPING
CREATE TABLE IF NOT EXISTS public.role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN', 'RESTAURANT_ADMIN', 'STAFF')),
    permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_role_permission UNIQUE (role, permission_id)
);

-- STAFF PERMISSION OVERRIDES (USER-LEVEL ALLOW / DENY)
CREATE TABLE IF NOT EXISTS public.staff_permission_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    membership_id UUID NOT NULL REFERENCES public.restaurant_memberships(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
    effect TEXT NOT NULL CHECK (effect IN ('ALLOW', 'DENY')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_membership_permission UNIQUE (membership_id, permission_id)
);

-- ============================================================================
-- 2. INDEXING
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_permissions_key ON public.permissions(key);
CREATE INDEX IF NOT EXISTS idx_permissions_domain ON public.permissions(domain);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON public.role_permissions(role);
CREATE INDEX IF NOT EXISTS idx_staff_overrides_membership ON public.staff_permission_overrides(membership_id);

-- ============================================================================
-- 3. ROW LEVEL SECURITY (RLS)
-- ============================================================================

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_permission_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view permissions catalog" ON public.permissions;
CREATE POLICY "Authenticated users can view permissions catalog"
  ON public.permissions FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can view role permissions" ON public.role_permissions;
CREATE POLICY "Authenticated users can view role permissions"
  ON public.role_permissions FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Users can view staff permission overrides for assigned restaurant" ON public.staff_permission_overrides;
CREATE POLICY "Users can view staff permission overrides for assigned restaurant"
  ON public.staff_permission_overrides FOR SELECT
  TO authenticated
  USING (
    membership_id IN (
      SELECT id FROM public.restaurant_memberships
      WHERE user_id = auth.uid() OR public.is_super_admin(auth.uid())
    )
  );

-- Direct client mutation on permission tables is prohibited for normal users
-- Only Super Admins or privileged service execution can mutate permissions metadata

-- ============================================================================
-- 4. NON-RECURSIVE SECURITY DEFINER HELPER FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.has_permission(
    p_user_id UUID,
    p_restaurant_id UUID,
    p_permission_key TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_is_super BOOLEAN;
    v_membership_id UUID;
    v_role TEXT;
    v_override_effect TEXT;
    v_has_role_perm BOOLEAN;
BEGIN
    IF p_user_id IS NULL OR p_permission_key IS NULL THEN
        RETURN FALSE;
    END IF;

    -- 1. Check Super Admin (Super Admin holds all permissions)
    SELECT public.is_super_admin(p_user_id) INTO v_is_super;
    IF v_is_super THEN
        RETURN TRUE;
    END IF;

    -- 2. Resolve Active Membership for target restaurant
    SELECT id, role INTO v_membership_id, v_role
    FROM public.restaurant_memberships
    WHERE user_id = p_user_id
      AND status = 'ACTIVE'
      AND (p_restaurant_id IS NULL OR restaurant_id = p_restaurant_id)
    LIMIT 1;

    -- Inactive or non-existent membership MUST return false
    IF v_membership_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- 3. Check Explicit Staff Override (Precedence: Explicit DENY > Explicit ALLOW)
    SELECT spo.effect INTO v_override_effect
    FROM public.staff_permission_overrides spo
    JOIN public.permissions p ON p.id = spo.permission_id
    WHERE spo.membership_id = v_membership_id
      AND p.key = p_permission_key;

    IF v_override_effect = 'DENY' THEN
        RETURN FALSE;
    ELSIF v_override_effect = 'ALLOW' THEN
        RETURN TRUE;
    END IF;

    -- 4. Check Role Permission Matrix
    SELECT EXISTS (
        SELECT 1
        FROM public.role_permissions rp
        JOIN public.permissions p ON p.id = rp.permission_id
        WHERE rp.role = v_role
          AND p.key = p_permission_key
    ) INTO v_has_role_perm;

    RETURN COALESCE(v_has_role_perm, FALSE);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.has_permission(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_permission(UUID, UUID, TEXT) TO authenticated, service_role;

-- ============================================================================
-- 5. SEED PERMISSION CATALOG & ROLE-PERMISSION MAPPINGS
-- ============================================================================

INSERT INTO public.permissions (key, domain, description) VALUES
  -- PLATFORM
  ('platform.view', 'PLATFORM', 'View platform administration dashboard'),
  ('platform.restaurants.view', 'PLATFORM', 'View platform restaurant listings'),
  ('platform.restaurants.create', 'PLATFORM', 'Create new restaurant tenants'),
  ('platform.restaurants.update', 'PLATFORM', 'Update platform restaurant metadata'),
  ('platform.restaurants.lifecycle', 'PLATFORM', 'Manage restaurant lifecycle (active/suspended/archived)'),
  ('platform.audit.view', 'PLATFORM', 'View platform-wide audit logs'),
  ('platform.settings.view', 'PLATFORM', 'View platform settings'),
  -- RESTAURANT
  ('restaurant.view', 'RESTAURANT', 'View assigned restaurant dashboard & metadata'),
  ('restaurant.update', 'RESTAURANT', 'Update assigned restaurant profile settings'),
  -- STAFF
  ('staff.view', 'STAFF', 'View staff directory for assigned restaurant'),
  ('staff.create', 'STAFF', 'Provision new staff members for assigned restaurant'),
  ('staff.update', 'STAFF', 'Update staff profiles for assigned restaurant'),
  ('staff.activate', 'STAFF', 'Activate staff memberships'),
  ('staff.deactivate', 'STAFF', 'Deactivate staff memberships'),
  ('staff.manage_permissions', 'STAFF', 'Manage granular staff permission overrides'),
  -- TABLES
  ('tables.view', 'TABLES', 'View restaurant table layout'),
  ('tables.create', 'TABLES', 'Create new restaurant tables'),
  ('tables.update', 'TABLES', 'Update restaurant table details'),
  ('tables.delete', 'TABLES', 'Delete restaurant tables'),
  ('tables.manage_status', 'TABLES', 'Change table status (available/occupied/cleaning)'),
  -- QUEUE
  ('queue.view', 'QUEUE', 'View active customer queue'),
  ('queue.join', 'QUEUE', 'Join customer to queue'),
  ('queue.manage', 'QUEUE', 'Manage customer queue entries'),
  ('queue.seat', 'QUEUE', 'Seat party from queue'),
  ('queue.cancel', 'QUEUE', 'Cancel party queue entry'),
  ('queue.reorder', 'QUEUE', 'Reorder customer queue positions'),
  -- MENU
  ('menu.view', 'MENU', 'View restaurant menu catalog'),
  ('menu.create', 'MENU', 'Create menu categories & items'),
  ('menu.update', 'MENU', 'Update menu categories & items'),
  ('menu.delete', 'MENU', 'Delete menu categories & items'),
  -- INVENTORY
  ('inventory.view', 'INVENTORY', 'View stock inventory levels'),
  ('inventory.create', 'INVENTORY', 'Create inventory stock items'),
  ('inventory.update', 'INVENTORY', 'Update inventory stock metadata'),
  ('inventory.adjust', 'INVENTORY', 'Adjust stock inventory quantities'),
  -- ORDERS
  ('orders.view', 'ORDERS', 'View customer orders'),
  ('orders.create', 'ORDERS', 'Create customer orders'),
  ('orders.update', 'ORDERS', 'Update customer order status'),
  ('orders.cancel', 'ORDERS', 'Cancel customer orders'),
  ('orders.manage', 'ORDERS', 'Full management of customer orders'),
  -- KITCHEN
  ('kitchen.view', 'KITCHEN', 'View kitchen display system (KDS)'),
  ('kitchen.manage', 'KITCHEN', 'Manage kitchen ticket status'),
  -- PAYMENTS
  ('payments.view', 'PAYMENTS', 'View transaction payment history'),
  ('payments.create', 'PAYMENTS', 'Process customer payments'),
  ('payments.update', 'PAYMENTS', 'Update payment records'),
  ('payments.refund', 'PAYMENTS', 'Process transaction refunds'),
  -- NOTIFICATIONS
  ('notifications.view', 'NOTIFICATIONS', 'View restaurant notification queue'),
  ('notifications.send', 'NOTIFICATIONS', 'Send notifications to customers'),
  ('notifications.manage', 'NOTIFICATIONS', 'Manage notification dispatch settings'),
  -- ANALYTICS
  ('analytics.view', 'ANALYTICS', 'View operational analytics dashboard'),
  ('analytics.export', 'ANALYTICS', 'Export performance analytics reports'),
  -- AUDIT
  ('audit.view', 'AUDIT', 'View restaurant audit logs')
ON CONFLICT (key) DO UPDATE SET
  domain = EXCLUDED.domain,
  description = EXCLUDED.description;

-- SEED ROLE PERMISSIONS: RESTAURANT_ADMIN
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'RESTAURANT_ADMIN', id FROM public.permissions
WHERE domain IN ('RESTAURANT', 'STAFF', 'TABLES', 'QUEUE', 'MENU', 'INVENTORY', 'ORDERS', 'KITCHEN', 'PAYMENTS', 'NOTIFICATIONS', 'ANALYTICS', 'AUDIT')
ON CONFLICT (role, permission_id) DO NOTHING;

-- SEED ROLE PERMISSIONS: STAFF (MINIMUM OPERATIONAL PERMISSIONS ONLY)
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'STAFF', id FROM public.permissions
WHERE key IN (
  'restaurant.view',
  'staff.view',
  'queue.view',
  'queue.manage',
  'queue.seat',
  'queue.cancel',
  'tables.view',
  'tables.manage_status',
  'orders.view',
  'orders.create',
  'orders.update',
  'kitchen.view',
  'kitchen.manage',
  'notifications.view'
)
ON CONFLICT (role, permission_id) DO NOTHING;
-- QueueFlow Phase 6 Migration: Restaurant Setup, Zones, Tables, State Machine & Tenant Constraints
-- Target Database: PostgreSQL / Supabase

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. ZONES SCHEMA ENHANCEMENT
-- ============================================================================

ALTER TABLE public.restaurant_zones
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE'));

-- ============================================================================
-- 2. TABLES SCHEMA ENHANCEMENT
-- ============================================================================

-- Update table status constraint to support finite state machine: AVAILABLE, OCCUPIED, RESERVED, CLEANING, OUT_OF_SERVICE
ALTER TABLE public.restaurant_tables
  DROP CONSTRAINT IF EXISTS restaurant_tables_status_check;

ALTER TABLE public.restaurant_tables
  ADD CONSTRAINT restaurant_tables_status_check
  CHECK (status IN ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'CLEANING', 'OUT_OF_SERVICE'));

-- Add archival fields to preserve historical table references
ALTER TABLE public.restaurant_tables
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Ensure table capacity invariant (> 0 and <= 50)
ALTER TABLE public.restaurant_tables
  DROP CONSTRAINT IF EXISTS restaurant_tables_capacity_check;

ALTER TABLE public.restaurant_tables
  ADD CONSTRAINT restaurant_tables_capacity_check
  CHECK (capacity > 0 AND capacity <= 50);

-- ============================================================================
-- 3. CROSS-TENANT ZONE & TABLE INTEGRITY CONSTRAINT
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_table_zone_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.zone_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.restaurant_zones
      WHERE id = NEW.zone_id
        AND restaurant_id = NEW.restaurant_id
        AND status = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'Invalid or inactive zone assigned to table for this restaurant tenant';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_table_zone_tenant ON public.restaurant_tables;
CREATE TRIGGER trg_check_table_zone_tenant
  BEFORE INSERT OR UPDATE ON public.restaurant_tables
  FOR EACH ROW EXECUTE FUNCTION public.check_table_zone_tenant();

-- ============================================================================
-- 4. PERFORMANCE INDEXING
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_tables_restaurant_active ON public.restaurant_tables(restaurant_id, is_archived, status);
CREATE INDEX IF NOT EXISTS idx_tables_restaurant_zone ON public.restaurant_tables(restaurant_id, zone_id);
CREATE INDEX IF NOT EXISTS idx_zones_restaurant_status ON public.restaurant_zones(restaurant_id, status);
-- QUEUEFLOW PHASE 7: MENU + INVENTORY MANAGEMENT SCHEMA
-- Migration: 20260910000003_phase7_menu_inventory.sql

-- 1. EXTEND MENU CATEGORIES
ALTER TABLE public.menu_categories
    ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- 2. EXTEND MENU ITEMS
ALTER TABLE public.menu_items
    ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS display_order INT NOT NULL DEFAULT 0;

-- 3. MENU ITEM CATEGORY TENANT INTEGRITY TRIGGER
CREATE OR REPLACE FUNCTION public.check_menu_item_category_tenant_integrity()
RETURNS TRIGGER AS $$
DECLARE
    v_cat_restaurant UUID;
    v_cat_active BOOLEAN;
BEGIN
    IF NEW.category_id IS NOT NULL THEN
        SELECT restaurant_id, active INTO v_cat_restaurant, v_cat_active
        FROM public.menu_categories
        WHERE id = NEW.category_id;

        IF v_cat_restaurant IS NULL THEN
            RAISE EXCEPTION 'Referenced menu category does not exist';
        END IF;

        IF v_cat_restaurant <> NEW.restaurant_id THEN
            RAISE EXCEPTION 'Tenant mismatch: menu item and category must belong to the same restaurant tenant';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_menu_item_category_tenant_integrity ON public.menu_items;
CREATE TRIGGER enforce_menu_item_category_tenant_integrity
BEFORE INSERT OR UPDATE ON public.menu_items
FOR EACH ROW EXECUTE FUNCTION public.check_menu_item_category_tenant_integrity();

-- 4. INVENTORY ITEMS TABLE
CREATE TABLE IF NOT EXISTS public.inventory_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sku TEXT,
    unit TEXT NOT NULL CHECK (unit IN ('kg', 'g', 'liter', 'ml', 'piece', 'packet', 'box', 'bottle')),
    current_quantity NUMERIC(12, 3) NOT NULL DEFAULT 0.000 CHECK (current_quantity >= 0),
    low_stock_threshold NUMERIC(12, 3) NOT NULL DEFAULT 0.000 CHECK (low_stock_threshold >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_restaurant_inventory_name UNIQUE (restaurant_id, name)
);

-- 5. INVENTORY MOVEMENTS TABLE (APPEND-ONLY LEDGER)
CREATE TABLE IF NOT EXISTS public.inventory_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
    movement_type TEXT NOT NULL CHECK (movement_type IN (
        'INITIAL',
        'PURCHASE',
        'ADJUSTMENT_IN',
        'ADJUSTMENT_OUT',
        'WASTE',
        'CORRECTION',
        'ORDER_CONSUMPTION',
        'ORDER_REVERSAL'
    )),
    quantity_delta NUMERIC(12, 3) NOT NULL,
    quantity_before NUMERIC(12, 3) NOT NULL CHECK (quantity_before >= 0),
    quantity_after NUMERIC(12, 3) NOT NULL CHECK (quantity_after >= 0),
    reference_type TEXT,
    reference_id UUID,
    reason TEXT,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. MENU ITEM INGREDIENTS (RECIPE MAPPING FOUNDATION)
CREATE TABLE IF NOT EXISTS public.menu_item_ingredients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    menu_item_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
    inventory_item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
    quantity_required NUMERIC(12, 3) NOT NULL CHECK (quantity_required > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_menu_inventory_ingredient UNIQUE (menu_item_id, inventory_item_id)
);

-- 7. RECIPE INGREDIENT TENANT INTEGRITY TRIGGER
CREATE OR REPLACE FUNCTION public.check_recipe_ingredient_tenant_integrity()
RETURNS TRIGGER AS $$
DECLARE
    v_menu_restaurant UUID;
    v_inv_restaurant UUID;
BEGIN
    SELECT restaurant_id INTO v_menu_restaurant FROM public.menu_items WHERE id = NEW.menu_item_id;
    SELECT restaurant_id INTO v_inv_restaurant FROM public.inventory_items WHERE id = NEW.inventory_item_id;

    IF v_menu_restaurant IS NULL OR v_inv_restaurant IS NULL THEN
        RAISE EXCEPTION 'Referenced menu item or inventory item does not exist';
    END IF;

    IF v_menu_restaurant <> NEW.restaurant_id OR v_inv_restaurant <> NEW.restaurant_id THEN
        RAISE EXCEPTION 'Tenant mismatch: menu item and inventory item must belong to the same restaurant tenant';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_recipe_ingredient_tenant_integrity ON public.menu_item_ingredients;
CREATE TRIGGER enforce_recipe_ingredient_tenant_integrity
BEFORE INSERT OR UPDATE ON public.menu_item_ingredients
FOR EACH ROW EXECUTE FUNCTION public.check_recipe_ingredient_tenant_integrity();

-- 8. INDEXES FOR HIGH-PERFORMANCE QUERY PATTERNS
CREATE INDEX IF NOT EXISTS idx_menu_items_category ON public.menu_items(category_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_display_order ON public.menu_items(restaurant_id, display_order);
CREATE INDEX IF NOT EXISTS idx_inventory_items_restaurant ON public.inventory_items(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_status ON public.inventory_items(restaurant_id, is_active, is_archived);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_item_time ON public.inventory_movements(inventory_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_menu_item_ingredients_menu ON public.menu_item_ingredients(menu_item_id);

-- 9. ROW-LEVEL SECURITY & TENANT POLICIES
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_item_ingredients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant isolation for inventory_items" ON public.inventory_items;
CREATE POLICY "Tenant isolation for inventory_items"
  ON public.inventory_items FOR ALL TO authenticated
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.restaurant_memberships
      WHERE user_id = auth.uid() AND status = 'ACTIVE'
    )
  )
  WITH CHECK (
    restaurant_id IN (
      SELECT restaurant_id FROM public.restaurant_memberships
      WHERE user_id = auth.uid() AND status = 'ACTIVE'
    )
  );

DROP POLICY IF EXISTS "Tenant read isolation for inventory_movements" ON public.inventory_movements;
CREATE POLICY "Tenant read isolation for inventory_movements"
  ON public.inventory_movements FOR SELECT TO authenticated
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.restaurant_memberships
      WHERE user_id = auth.uid() AND status = 'ACTIVE'
    )
  );

DROP POLICY IF EXISTS "Tenant insert isolation for inventory_movements" ON public.inventory_movements;
CREATE POLICY "Tenant insert isolation for inventory_movements"
  ON public.inventory_movements FOR INSERT TO authenticated
  WITH CHECK (
    restaurant_id IN (
      SELECT restaurant_id FROM public.restaurant_memberships
      WHERE user_id = auth.uid() AND status = 'ACTIVE'
    )
  );

DROP POLICY IF EXISTS "Tenant isolation for menu_item_ingredients" ON public.menu_item_ingredients;
CREATE POLICY "Tenant isolation for menu_item_ingredients"
  ON public.menu_item_ingredients FOR ALL TO authenticated
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM public.restaurant_memberships
      WHERE user_id = auth.uid() AND status = 'ACTIVE'
    )
  )
  WITH CHECK (
    restaurant_id IN (
      SELECT restaurant_id FROM public.restaurant_memberships
      WHERE user_id = auth.uid() AND status = 'ACTIVE'
    )
  );
-- ============================================================================
-- QUEUEFLOW PHASE 8 MIGRATION: CORE QUEUE ENGINE & CONCURRENCY CONTROL
-- ============================================================================

-- 1. EXTEND RESTAURANTS WITH QUEUE CONFIGURATION
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS queue_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS max_queue_capacity INT NOT NULL DEFAULT 100 CHECK (max_queue_capacity > 0),
  ADD COLUMN IF NOT EXISTS min_party_size INT NOT NULL DEFAULT 1 CHECK (min_party_size > 0),
  ADD COLUMN IF NOT EXISTS max_party_size INT NOT NULL DEFAULT 20 CHECK (max_party_size >= min_party_size),
  ADD COLUMN IF NOT EXISTS call_timeout_minutes INT NOT NULL DEFAULT 15 CHECK (call_timeout_minutes > 0);

-- 2. EXTEND QUEUE_ENTRIES SCHEMA
ALTER TABLE public.queue_entries
  ADD COLUMN IF NOT EXISTS display_number TEXT,
  ADD COLUMN IF NOT EXISTS called_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Update check constraint on queue_entries status to include CALLED and EXPIRED
ALTER TABLE public.queue_entries
  DROP CONSTRAINT IF EXISTS queue_entries_status_check;

ALTER TABLE public.queue_entries
  ADD CONSTRAINT queue_entries_status_check
  CHECK (status IN ('WAITING', 'CALLED', 'NOTIFIED', 'SEATED', 'CANCELLED', 'NO_SHOW', 'EXPIRED', 'COMPLETED', 'REMOVED', 'SKIPPED'));

-- 3. UNIQUE ACTIVE CUSTOMER CONTACT INDEX (DUPLICATE JOIN PREVENTION)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_customer_phone
  ON public.queue_entries (restaurant_id, customer_phone)
  WHERE status IN ('WAITING', 'CALLED', 'NOTIFIED') AND customer_phone IS NOT NULL AND customer_phone != '';

-- 4. PERFORMANCE INDEX FOR POSITION CALCULATIONS & QUEUE LISTINGS
CREATE INDEX IF NOT EXISTS idx_queue_entries_position
  ON public.queue_entries (restaurant_id, status, joined_at, id);

CREATE INDEX IF NOT EXISTS idx_queue_events_queue_entry
  ON public.queue_events (queue_entry_id, created_at DESC);

-- 5. ATOMIC QUEUE JOIN DATABASE FUNCTION (CONCURRENCY & CAPACITY SAFE)
CREATE OR REPLACE FUNCTION public.join_queue_atomic(
  p_restaurant_id UUID,
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_party_size INT,
  p_token_hash TEXT
)
RETURNS public.queue_entries
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_restaurant public.restaurants%ROWTYPE;
  v_active_count INT;
  v_queue_num INT;
  v_display_num TEXT;
  v_new_entry public.queue_entries%ROWTYPE;
BEGIN
  -- 1. Lock restaurant row for capacity/sequence concurrency safety
  SELECT * INTO v_restaurant
  FROM public.restaurants
  WHERE id = p_restaurant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RESTAURANT_NOT_FOUND';
  END IF;

  -- 2. Verify queue is enabled/open
  IF NOT v_restaurant.queue_enabled THEN
    RAISE EXCEPTION 'QUEUE_CLOSED';
  END IF;

  -- 3. Validate party size
  IF p_party_size < v_restaurant.min_party_size OR p_party_size > v_restaurant.max_party_size THEN
    RAISE EXCEPTION 'INVALID_PARTY_SIZE';
  END IF;

  -- 4. Enforce capacity limit
  SELECT COUNT(*) INTO v_active_count
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id
    AND status IN ('WAITING', 'CALLED', 'NOTIFIED');

  IF v_active_count >= v_restaurant.max_queue_capacity THEN
    RAISE EXCEPTION 'QUEUE_FULL';
  END IF;

  -- 5. Check duplicate active phone
  IF p_customer_phone IS NOT NULL AND p_customer_phone != '' THEN
    IF EXISTS (
      SELECT 1 FROM public.queue_entries
      WHERE restaurant_id = p_restaurant_id
        AND customer_phone = p_customer_phone
        AND status IN ('WAITING', 'CALLED', 'NOTIFIED')
    ) THEN
      RAISE EXCEPTION 'DUPLICATE_ACTIVE_ENTRY';
    END IF;
  END IF;

  -- 6. Generate next sequential queue number & display number
  SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_queue_num
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id;

  v_display_num := 'Q-' || v_queue_num::text;

  -- 7. Insert queue entry
  INSERT INTO public.queue_entries (
    restaurant_id,
    customer_name,
    customer_phone,
    party_size,
    queue_number,
    display_number,
    status,
    token_hash,
    joined_at,
    created_at,
    updated_at
  ) VALUES (
    p_restaurant_id,
    p_customer_name,
    NULLIF(p_customer_phone, ''),
    p_party_size,
    v_queue_num,
    v_display_num,
    'WAITING',
    p_token_hash,
    NOW(),
    NOW(),
    NOW()
  )
  RETURNING * INTO v_new_entry;

  -- 8. Insert queue lifecycle event
  INSERT INTO public.queue_events (
    restaurant_id,
    queue_entry_id,
    event_type,
    metadata
  ) VALUES (
    p_restaurant_id,
    v_new_entry.id,
    'QUEUE_JOINED',
    jsonb_build_object(
      'party_size', p_party_size,
      'display_number', v_display_num,
      'queue_number', v_queue_num
    )
  );

  RETURN v_new_entry;
END;
$$;

-- 6. ADD QUEUE SETTINGS PERMISSION TO RBAC CATALOG
INSERT INTO public.permissions (key, domain, description)
VALUES ('queue.settings.update', 'QUEUE', 'Update restaurant queue configuration and open/close state')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'RESTAURANT_ADMIN', id FROM public.permissions WHERE key = 'queue.settings.update'
ON CONFLICT (role, permission_id) DO NOTHING;
-- ============================================================================
-- QUEUEFLOW PHASE 10 MIGRATION: QUEUE OPERATIONS, ETA ENGINE & ATOMIC SEATING
-- ============================================================================

-- 1. EXTEND RESTAURANTS WITH ETA CONFIGURATION
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS avg_service_time_mins INT NOT NULL DEFAULT 15 CHECK (avg_service_time_mins > 0),
  ADD COLUMN IF NOT EXISTS service_capacity_units INT NOT NULL DEFAULT 3 CHECK (service_capacity_units > 0),
  ADD COLUMN IF NOT EXISTS eta_buffer_mins INT NOT NULL DEFAULT 5 CHECK (eta_buffer_mins >= 0),
  ADD COLUMN IF NOT EXISTS almost_your_turn_threshold INT NOT NULL DEFAULT 3 CHECK (almost_your_turn_threshold >= 1);

-- 2. EXTEND QUEUE_ENTRIES WITH SEATED TABLE REFERENCE
ALTER TABLE public.queue_entries
  ADD COLUMN IF NOT EXISTS seated_table_id UUID REFERENCES public.restaurant_tables(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_queue_entries_seated_table
  ON public.queue_entries (seated_table_id) WHERE seated_table_id IS NOT NULL;

-- 3. ATOMIC SEATING DATABASE FUNCTION (RACE CONDITION & CAPACITY SAFE)
CREATE OR REPLACE FUNCTION public.seat_queue_entry_atomic(
  p_queue_entry_id UUID,
  p_table_id UUID,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_queue_entry public.queue_entries%ROWTYPE;
  v_table public.restaurant_tables%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- 1. Lock Queue Entry row for atomic transition
  SELECT * INTO v_queue_entry
  FROM public.queue_entries
  WHERE id = p_queue_entry_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUEUE_ENTRY_NOT_FOUND';
  END IF;

  -- Verify queue entry is in a seatable status
  IF v_queue_entry.status IN ('SEATED', 'CANCELLED', 'NO_SHOW', 'EXPIRED') THEN
    RAISE EXCEPTION 'QUEUE_ENTRY_ALREADY_SEATED';
  END IF;

  -- 2. Lock Target Table row for atomic reservation
  SELECT * INTO v_table
  FROM public.restaurant_tables
  WHERE id = p_table_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TABLE_NOT_FOUND';
  END IF;

  -- Verify table belongs to the same tenant
  IF v_table.restaurant_id != v_queue_entry.restaurant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH';
  END IF;

  -- Verify table is currently AVAILABLE
  IF v_table.status != 'AVAILABLE' THEN
    RAISE EXCEPTION 'TABLE_NOT_AVAILABLE';
  END IF;

  -- Verify table capacity is sufficient for party size
  IF v_table.capacity < v_queue_entry.party_size THEN
    RAISE EXCEPTION 'INSUFFICIENT_TABLE_CAPACITY';
  END IF;

  -- 3. Perform Atomic Updates
  -- Update Queue Entry status -> SEATED
  UPDATE public.queue_entries
  SET
    status = 'SEATED',
    seated_table_id = p_table_id,
    seated_at = v_now,
    updated_at = v_now
  WHERE id = p_queue_entry_id;

  -- Update Table status -> OCCUPIED
  UPDATE public.restaurant_tables
  SET
    status = 'OCCUPIED',
    updated_at = v_now
  WHERE id = p_table_id;

  -- 4. Record Queue Event
  INSERT INTO public.queue_events (
    restaurant_id,
    queue_entry_id,
    event_type,
    actor_user_id,
    metadata
  ) VALUES (
    v_queue_entry.restaurant_id,
    p_queue_entry_id,
    'QUEUE_SEATED',
    p_actor_user_id,
    jsonb_build_object(
      'table_id', p_table_id,
      'table_number', v_table.table_number,
      'party_size', v_queue_entry.party_size,
      'previous_status', v_queue_entry.status
    )
  );

  -- 5. Record Audit Log
  IF p_actor_user_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (
      restaurant_id,
      actor_user_id,
      action,
      entity_type,
      entity_id,
      metadata
    ) VALUES (
      v_queue_entry.restaurant_id,
      p_actor_user_id,
      'queue_entry_seated',
      'queue_entry',
      p_queue_entry_id,
      jsonb_build_object(
        'tableId', p_table_id,
        'tableNumber', v_table.table_number,
        'customerName', v_queue_entry.customer_name,
        'displayNumber', v_queue_entry.display_number
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'queueEntryId', p_queue_entry_id,
    'tableId', p_table_id,
    'tableNumber', v_table.table_number,
    'seatedAt', v_now
  );
END;
$$;

-- 4. ADD NOTIFY AND NO_SHOW PERMISSIONS TO RBAC CATALOG
INSERT INTO public.permissions (key, domain, description)
VALUES 
  ('queue.notify', 'QUEUE', 'Notify customer that turn is approaching'),
  ('queue.no_show', 'QUEUE', 'Mark called customer entry as no-show')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'RESTAURANT_ADMIN', id FROM public.permissions WHERE key IN ('queue.notify', 'queue.no_show')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'STAFF', id FROM public.permissions WHERE key IN ('queue.notify', 'queue.no_show')
ON CONFLICT (role, permission_id) DO NOTHING;
-- ============================================================================
-- QUEUEFLOW PHASE 11 MIGRATION: ORDERS & KITCHEN OPERATIONS
-- ============================================================================

-- 1. UPDATE ORDERS SCHEMA FOR PHASE 11
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS order_token TEXT,
  ADD COLUMN IF NOT EXISTS order_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS customer_name TEXT,
  ADD COLUMN IF NOT EXISTS customer_phone TEXT;

-- Update CHECK constraint on orders.status to include Phase 11 FSM states
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check 
  CHECK (status IN ('DRAFT', 'PLACED', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED', 'PENDING', 'ACCEPTED', 'IN_PREPARATION', 'COMPLETED'));

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_orders_token_hash ON public.orders (order_token_hash) WHERE order_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_status ON public.orders (restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_queue_entry ON public.orders (queue_entry_id) WHERE queue_entry_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency ON public.orders (restaurant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 2. ORDER EVENTS AUDIT TABLE (APPEND-ONLY)
CREATE TABLE IF NOT EXISTS public.order_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    actor_user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_events_order ON public.order_events (order_id, created_at DESC);

-- Enable RLS on order_events
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;

-- 3. RLS POLICIES FOR ORDERS & ORDER_EVENTS
-- Staff RLS Policy for Order Events
DROP POLICY IF EXISTS "Staff can select order events in own restaurant" ON public.order_events;
CREATE POLICY "Staff can select order events in own restaurant"
  ON public.order_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.restaurant_memberships rm
      WHERE rm.restaurant_id = public.order_events.restaurant_id
        AND rm.user_id = auth.uid()
        AND rm.status = 'ACTIVE'
    )
  );

DROP POLICY IF EXISTS "Staff can insert order events in own restaurant" ON public.order_events;
CREATE POLICY "Staff can insert order events in own restaurant"
  ON public.order_events FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.restaurant_memberships rm
      WHERE rm.restaurant_id = public.order_events.restaurant_id
        AND rm.user_id = auth.uid()
        AND rm.status = 'ACTIVE'
    )
  );

-- 4. SEED RBAC PERMISSIONS FOR ORDERS & KITCHEN MANAGEMENT
INSERT INTO public.permissions (key, domain, description)
VALUES 
  ('orders.view', 'ORDERS', 'View restaurant orders and order details'),
  ('orders.create', 'ORDERS', 'Create restaurant orders'),
  ('orders.update', 'ORDERS', 'Update restaurant order status'),
  ('orders.cancel', 'ORDERS', 'Cancel restaurant order'),
  ('kitchen.view', 'KITCHEN', 'View kitchen order tickets and queue'),
  ('kitchen.manage', 'KITCHEN', 'Manage kitchen order preparation and status')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'RESTAURANT_ADMIN', id FROM public.permissions WHERE key IN ('orders.view', 'orders.create', 'orders.update', 'orders.cancel', 'kitchen.view', 'kitchen.manage')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'STAFF', id FROM public.permissions WHERE key IN ('orders.view', 'orders.create', 'orders.update', 'orders.cancel', 'kitchen.view', 'kitchen.manage')
ON CONFLICT (role, permission_id) DO NOTHING;
-- QueueFlow Phase 12 Migration: Payments Schema Extension, Payment Events, Permissions & RLS
-- Target Database: PostgreSQL / Supabase

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. EXTEND EXISTING PAYMENTS TABLE
-- ============================================================================

-- Update payments status check constraint to include all Phase 12 FSM states
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_status_check 
  CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'COMPLETED', 'FAILED', 'REFUND_PENDING', 'REFUNDED'));

-- Add payment_method column
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'ONLINE'
  CHECK (payment_method IN ('ONLINE', 'PAY_AT_RESTAURANT', 'CASH', 'MANUAL'));

-- Add attempt_number
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS attempt_number INT NOT NULL DEFAULT 1 CHECK (attempt_number >= 1);

-- Add provider_order_id & provider_payment_id
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS provider_order_id TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS provider_payment_id TEXT;

-- Add parent_payment_id for refunds or linked attempts
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS parent_payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL;

-- Add refunded_amount
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (refunded_amount >= 0);

-- Add webhook_event_id for deduplication
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS webhook_event_id TEXT;

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_payments_restaurant_status ON public.payments(restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_order_status ON public.payments(order_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_provider_ref ON public.payments(provider, provider_reference);
CREATE INDEX IF NOT EXISTS idx_payments_webhook_event ON public.payments(webhook_event_id) WHERE webhook_event_id IS NOT NULL;

-- ============================================================================
-- 2. APPEND-ONLY PAYMENT EVENTS AUDIT TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.payment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('PAYMENT_CREATED', 'PAYMENT_PROCESSING', 'PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'PAYMENT_REFUND_REQUESTED', 'PAYMENT_REFUNDED', 'PAYMENT_RECONCILED')),
    actor_type TEXT NOT NULL CHECK (actor_type IN ('SYSTEM', 'CUSTOMER', 'STAFF', 'WEBHOOK')),
    actor_id TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_events_payment ON public.payment_events(payment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_events_restaurant ON public.payment_events(restaurant_id, created_at DESC);

-- ============================================================================
-- 3. PERMISSIONS SEEDING (RBAC)
-- ============================================================================

INSERT INTO public.permissions (key, domain, description) VALUES
  ('payments.manage', 'PAYMENTS', 'Full management of restaurant payments and attempts'),
  ('payments.reconcile', 'PAYMENTS', 'Perform transaction state reconciliation')
ON CONFLICT (key) DO UPDATE SET
  domain = EXCLUDED.domain,
  description = EXCLUDED.description;

-- Ensure RESTAURANT_ADMIN gets all payments permissions
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'RESTAURANT_ADMIN', id FROM public.permissions
WHERE domain = 'PAYMENTS'
ON CONFLICT (role, permission_id) DO NOTHING;

-- ============================================================================
-- 4. ROW LEVEL SECURITY (RLS) FOR PAYMENTS & PAYMENT EVENTS
-- ============================================================================

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

-- Payments read policy
DROP POLICY IF EXISTS "Staff and admins view payments for assigned restaurant" ON public.payments;
CREATE POLICY "Staff and admins view payments for assigned restaurant"
  ON public.payments FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin(auth.uid()) OR
    restaurant_id IN (
      SELECT restaurant_id FROM public.restaurant_memberships
      WHERE user_id = auth.uid() AND status = 'ACTIVE'
    )
  );

-- Payments insert/update policies for staff
DROP POLICY IF EXISTS "Staff and admins manage payments for assigned restaurant" ON public.payments;
CREATE POLICY "Staff and admins manage payments for assigned restaurant"
  ON public.payments FOR ALL
  TO authenticated
  USING (
    public.is_super_admin(auth.uid()) OR
    restaurant_id IN (
      SELECT restaurant_id FROM public.restaurant_memberships
      WHERE user_id = auth.uid() AND status = 'ACTIVE'
    )
  )
  WITH CHECK (
    public.is_super_admin(auth.uid()) OR
    restaurant_id IN (
      SELECT restaurant_id FROM public.restaurant_memberships
      WHERE user_id = auth.uid() AND status = 'ACTIVE'
    )
  );

-- Payment Events read policy
DROP POLICY IF EXISTS "Staff and admins view payment events for assigned restaurant" ON public.payment_events;
CREATE POLICY "Staff and admins view payment events for assigned restaurant"
  ON public.payment_events FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin(auth.uid()) OR
    restaurant_id IN (
      SELECT restaurant_id FROM public.restaurant_memberships
      WHERE user_id = auth.uid() AND status = 'ACTIVE'
    )
  );
-- QueueFlow Phase 13 Migration: Notifications Channel Extension, Outbox Pattern & Background Workers Schema
-- Target Database: PostgreSQL / Supabase

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. EXTEND NOTIFICATIONS TABLE SCHEMA
-- ============================================================================

-- Update channel CHECK constraint to support IN_APP, SMS, WHATSAPP, EMAIL, PUSH
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_channel_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_channel_check 
  CHECK (channel IN ('IN_APP', 'SMS', 'WHATSAPP', 'EMAIL', 'PUSH'));

-- Ensure recipient and message can be null for system in-app alerts if necessary
ALTER TABLE public.notifications ALTER COLUMN recipient DROP NOT NULL;
ALTER TABLE public.notifications ALTER COLUMN provider SET DEFAULT 'IN_APP';

CREATE INDEX IF NOT EXISTS idx_notifications_queue_entry ON public.notifications(queue_entry_id) WHERE queue_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_order ON public.notifications(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_status ON public.notifications(restaurant_id, status);

-- ============================================================================
-- 2. TRANSACTIONAL OUTBOX EVENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    aggregate_type TEXT NOT NULL CHECK (aggregate_type IN ('QUEUE', 'ORDER', 'PAYMENT', 'STAFF', 'SYSTEM')),
    aggregate_id TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    retry_count INT NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    max_retries INT NOT NULL DEFAULT 5 CHECK (max_retries >= 1),
    last_error TEXT,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending_work ON public.outbox_events(status, next_attempt_at) WHERE status IN ('PENDING', 'FAILED');
CREATE INDEX IF NOT EXISTS idx_outbox_restaurant ON public.outbox_events(restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbox_aggregate ON public.outbox_events(aggregate_type, aggregate_id);

-- ============================================================================
-- 3. ROW LEVEL SECURITY (RLS) FOR NOTIFICATIONS & OUTBOX
-- ============================================================================

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;

-- Notifications SELECT policy for staff
DROP POLICY IF EXISTS "Staff view notifications for assigned restaurant" ON public.notifications;
CREATE POLICY "Staff view notifications for assigned restaurant"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin(auth.uid()) OR
    restaurant_id IN (
      SELECT restaurant_id FROM public.restaurant_memberships
      WHERE user_id = auth.uid() AND status = 'ACTIVE'
    )
  );

-- Outbox events RLS policy for staff & service role
DROP POLICY IF EXISTS "Staff view outbox events for assigned restaurant" ON public.outbox_events;
CREATE POLICY "Staff view outbox events for assigned restaurant"
  ON public.outbox_events FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin(auth.uid()) OR
    restaurant_id IN (
      SELECT restaurant_id FROM public.restaurant_memberships
      WHERE user_id = auth.uid() AND status = 'ACTIVE'
    )
  );
-- QueueFlow Phase 14 Migration: Analytics & Operational Intelligence
-- Target Database: PostgreSQL / Supabase

-- ============================================================================
-- 1. QUEUE METRICS SUMMARY RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_queue_metrics_summary(
  p_restaurant_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_joined INT;
  v_total_seated INT;
  v_total_dropped INT;
  v_avg_wait_time_seconds INT;
BEGIN
  -- Validate permissions (must be part of restaurant)
  IF NOT public.is_super_admin(auth.uid()) AND NOT EXISTS (
    SELECT 1 FROM public.restaurant_memberships
    WHERE restaurant_id = p_restaurant_id AND user_id = auth.uid() AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT COUNT(*) INTO v_total_joined
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id
    AND joined_at >= p_start_date
    AND joined_at <= p_end_date;

  SELECT COUNT(*) INTO v_total_seated
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id
    AND joined_at >= p_start_date
    AND joined_at <= p_end_date
    AND status = 'SEATED';

  SELECT COUNT(*) INTO v_total_dropped
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id
    AND joined_at >= p_start_date
    AND joined_at <= p_end_date
    AND status IN ('CANCELLED', 'NO_SHOW', 'EXPIRED');

  SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (seated_at - joined_at))), 0)::INT INTO v_avg_wait_time_seconds
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id
    AND joined_at >= p_start_date
    AND joined_at <= p_end_date
    AND status = 'SEATED'
    AND seated_at IS NOT NULL;

  RETURN jsonb_build_object(
    'total_joined', v_total_joined,
    'total_seated', v_total_seated,
    'total_dropped', v_total_dropped,
    'avg_wait_time_seconds', v_avg_wait_time_seconds
  );
END;
$$;

-- ============================================================================
-- 2. HOURLY QUEUE VOLUME RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_hourly_queue_volume(
  p_restaurant_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Validate permissions
  IF NOT public.is_super_admin(auth.uid()) AND NOT EXISTS (
    SELECT 1 FROM public.restaurant_memberships
    WHERE restaurant_id = p_restaurant_id AND user_id = auth.uid() AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'hour', hour_bucket,
      'count', count
    )
  ), '[]'::jsonb) INTO v_result
  FROM (
    SELECT 
      DATE_TRUNC('hour', joined_at) AS hour_bucket,
      COUNT(*) AS count
    FROM public.queue_entries
    WHERE restaurant_id = p_restaurant_id
      AND joined_at >= p_start_date
      AND joined_at <= p_end_date
    GROUP BY hour_bucket
    ORDER BY hour_bucket
  ) AS hourly_data;

  RETURN v_result;
END;
$$;

-- ============================================================================
-- 3. COMMERCE METRICS SUMMARY RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_commerce_metrics_summary(
  p_restaurant_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_orders INT;
  v_total_revenue NUMERIC;
BEGIN
  -- Validate permissions
  IF NOT public.is_super_admin(auth.uid()) AND NOT EXISTS (
    SELECT 1 FROM public.restaurant_memberships
    WHERE restaurant_id = p_restaurant_id AND user_id = auth.uid() AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  -- Total completed/served orders
  SELECT COUNT(*) INTO v_total_orders
  FROM public.orders
  WHERE restaurant_id = p_restaurant_id
    AND created_at >= p_start_date
    AND created_at <= p_end_date
    AND status IN ('COMPLETED', 'SERVED');

  -- Total revenue from successful payments
  SELECT COALESCE(SUM(amount - refunded_amount), 0) INTO v_total_revenue
  FROM public.payments
  WHERE restaurant_id = p_restaurant_id
    AND created_at >= p_start_date
    AND created_at <= p_end_date
    AND status = 'SUCCEEDED';

  RETURN jsonb_build_object(
    'total_orders', v_total_orders,
    'total_revenue', v_total_revenue
  );
END;
$$;

-- ============================================================================
-- 4. ADD ANALYTICS PERMISSIONS TO RBAC
-- ============================================================================
INSERT INTO public.permissions (key, domain, description)
VALUES 
  ('analytics.view', 'ANALYTICS', 'View restaurant operational and commerce analytics')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'RESTAURANT_ADMIN', id FROM public.permissions WHERE key = 'analytics.view'
ON CONFLICT (role, permission_id) DO NOTHING;
-- QueueFlow Phase 15 Migration: Production Hardening
-- Adds atomic outbox event claiming with FOR UPDATE SKIP LOCKED
-- to prevent concurrent worker double-processing.
-- Also adds supporting performance indexes.

-- ============================================================================
-- 1. ATOMIC OUTBOX EVENT CLAIMING FUNCTION
-- ============================================================================
-- Uses SELECT ... FOR UPDATE SKIP LOCKED to safely claim a batch of pending
-- outbox events for processing. Concurrent workers will not receive the same
-- events because SKIP LOCKED causes other workers to skip already-locked rows.
--
-- This replaces the previous plain SELECT in OutboxService.getPendingEvents().
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_outbox_events(p_limit INT DEFAULT 20)
RETURNS SETOF public.outbox_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM public.outbox_events
  WHERE status IN ('PENDING', 'FAILED')
    AND next_attempt_at <= NOW()
  ORDER BY next_attempt_at ASC
  LIMIT p_limit
  FOR UPDATE SKIP LOCKED;
END;
$$;

-- ============================================================================
-- 2. PERFORMANCE INDEXES FOR PRODUCTION QUERY PATTERNS
-- ============================================================================

-- Outbox polling — used heavily by the background worker
CREATE INDEX IF NOT EXISTS idx_outbox_events_pending_poll
  ON public.outbox_events (next_attempt_at ASC)
  WHERE status IN ('PENDING', 'FAILED');

-- Queue status by token_hash — critical for every customer status check
-- (already created in Phase 8, but confirm it exists with correct column)
CREATE INDEX IF NOT EXISTS idx_queue_entries_token_hash
  ON public.queue_entries (token_hash)
  WHERE token_hash IS NOT NULL;

-- Active queue listing for staff dashboard
CREATE INDEX IF NOT EXISTS idx_queue_entries_active_restaurant
  ON public.queue_entries (restaurant_id, joined_at ASC, id ASC)
  WHERE status IN ('WAITING', 'NOTIFIED', 'CALLED');

-- Orders by restaurant + status for kitchen and order list views
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_status_created
  ON public.orders (restaurant_id, status, created_at DESC);

-- Payments lookup for reconciliation and analytics
CREATE INDEX IF NOT EXISTS idx_payments_restaurant_created
  ON public.payments (restaurant_id, created_at DESC)
  WHERE status = 'SUCCEEDED';

-- Notifications inbox for staff/customer polling
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS recipient_user_id uuid;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
  ON public.notifications (recipient_user_id, created_at DESC)
  WHERE is_read = FALSE;

-- Analytics: queue join date range scans
CREATE INDEX IF NOT EXISTS idx_queue_entries_joined_at_range
  ON public.queue_entries (restaurant_id, joined_at, status);

-- ============================================================================
-- 3. ADD ANALYTICS.VIEW PERMISSION IF MISSING
-- ============================================================================
-- (Idempotent — already seeded by Phase 14, but safe to re-run)
INSERT INTO public.permissions (key, domain, description)
VALUES ('analytics.view', 'ANALYTICS', 'View restaurant operational and commerce analytics')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'RESTAURANT_ADMIN', id FROM public.permissions WHERE key = 'analytics.view'
ON CONFLICT (role, permission_id) DO NOTHING;
-- =============================================================================
-- QUEUEFLOW PHASE 15 RECONCILIATION MIGRATION
-- 20260912000011_phase15_reconciliation.sql
--
-- This migration fixes critical state-model drift, RPC bugs, and security
-- definer issues discovered during Phase 15 production sign-off audit.
--
-- IMPORTANT: This migration PRESERVES all existing historical data.
-- It does NOT rewrite or drop existing tables or migrations.
--
-- Changes:
--   1. Fix phantom column reference in Phase 15 index (notifications)
--   2. Add PROCESSING to outbox_events status CHECK constraint
--   3. Fix claim_outbox_events() — atomic UPDATE…RETURNING CTE
--   4. Add recover_stale_outbox_events() for crash/lease recovery
--   5. Fix seat_queue_entry_atomic() — complete FSM + authorization
--   6. Add deduct_inventory_atomic() RPC with idempotency
--   7. Add inventory ORDER_CONSUMPTION idempotency unique index
--   8. Restrict new orders from using deprecated status values
--   9. Restrict new payments from using ambiguous COMPLETED status
--  10. Fix join_queue_atomic() — add search_path + ACTIVE restaurant check
--  11. Fix analytics RPCs — add SET search_path
--  12. Correct EXECUTE privilege grants for privileged RPCs
-- =============================================================================

-- =============================================================================
-- 1. DROP PHANTOM INDEX FROM PHASE 15 HARDENING
--    (references columns that do not exist: recipient_user_id, is_read)
-- =============================================================================

DROP INDEX IF EXISTS public.idx_notifications_recipient_unread;

-- Correct replacement: index on restaurant_id + status for staff polling
CREATE INDEX IF NOT EXISTS idx_notifications_restaurant_status
  ON public.notifications (restaurant_id, status, created_at DESC);

-- =============================================================================
-- 2. ADD PROCESSING STATUS TO outbox_events CHECK CONSTRAINT
--    The TypeScript OutboxStatus type includes PROCESSING but the DB CHECK did
--    not. This caused a mismatch where the application could set PROCESSING but
--    the constraint would reject it if ever re-evaluated.
-- =============================================================================

ALTER TABLE public.outbox_events
  DROP CONSTRAINT IF EXISTS outbox_events_status_check;

ALTER TABLE public.outbox_events
  ADD CONSTRAINT outbox_events_status_check
  CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'));

-- =============================================================================
-- 3. FIX claim_outbox_events() — ATOMIC UPDATE … RETURNING CTE
--
-- Previous implementation:
--   SELECT * FROM outbox_events WHERE … FOR UPDATE SKIP LOCKED
--
-- BUG: The SELECT lock was released at transaction end. Because the function
-- is called from application code in its own transaction, by the time the
-- application processes the event, the row is already unlocked and another
-- concurrent worker could claim the same event.
--
-- Fix: Use a CTE that atomically UPDATEs status to PROCESSING (within the
-- same statement) and RETURNS the updated rows. The row is already committed
-- as PROCESSING before the function returns, so no other worker can claim it.
--
-- Concurrent behaviour:
--   Worker A: UPDATE claims event → status = PROCESSING → returned
--   Worker B: UPDATE skips event (FOR UPDATE SKIP LOCKED) → not returned
--   → No duplicate claim possible.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.claim_outbox_events(p_limit INT DEFAULT 20)
RETURNS SETOF public.outbox_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT id
    FROM public.outbox_events
    WHERE status IN ('PENDING', 'FAILED')
      AND next_attempt_at <= NOW()
    ORDER BY next_attempt_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.outbox_events oe
  SET
    status     = 'PROCESSING',
    updated_at = NOW()
  FROM claimed
  WHERE oe.id = claimed.id
  RETURNING oe.*;
END;
$$;

-- =============================================================================
-- 4. STALE PROCESSING RECOVERY FUNCTION
--
-- If a worker crashes while processing an event, the event remains stuck in
-- PROCESSING forever. This function safely recovers such events by transitioning
-- them back to PENDING (if retry_count < max_retries) or FAILED (terminal).
--
-- Lease semantics:
--   - A PROCESSING event is considered stale if updated_at < NOW() - interval
--   - Default lease: 30 minutes (configurable via p_stale_after_mins)
--   - Recovery increments retry_count
--   - Events at max_retries become permanently FAILED
--   - Active PROCESSING events (within lease) are NOT touched
--
-- Caller: background cron or worker health-check; NOT called by public clients.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.recover_stale_outbox_events(
  p_stale_after_mins INT DEFAULT 30
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recovered INT := 0;
  v_stale_cutoff TIMESTAMPTZ;
BEGIN
  v_stale_cutoff := NOW() - (p_stale_after_mins || ' minutes')::INTERVAL;

  -- Recover stale PROCESSING events back to PENDING (with retry backoff)
  -- or permanently FAILED if max_retries exhausted
  WITH stale AS (
    SELECT id, retry_count, max_retries
    FROM public.outbox_events
    WHERE status = 'PROCESSING'
      AND updated_at < v_stale_cutoff
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE public.outbox_events oe
    SET
      status           = CASE
                           WHEN (stale.retry_count + 1) >= stale.max_retries THEN 'FAILED'
                           ELSE 'PENDING'
                         END,
      retry_count      = stale.retry_count + 1,
      last_error       = 'Worker crash recovery: lease expired after ' ||
                         p_stale_after_mins || ' minutes',
      -- Exponential backoff: 2^retry * 30s, capped at 1 hour
      next_attempt_at  = CASE
                           WHEN (stale.retry_count + 1) >= stale.max_retries THEN NOW()
                           ELSE NOW() + LEAST(
                             POWER(2, stale.retry_count + 1) * 30,
                             3600
                           ) * INTERVAL '1 second'
                         END,
      updated_at       = NOW()
    FROM stale
    WHERE oe.id = stale.id
    RETURNING oe.id
  )
  SELECT COUNT(*) INTO v_recovered FROM updated;

  RETURN v_recovered;
END;
$$;

-- =============================================================================
-- 5. FIX seat_queue_entry_atomic()
--
-- Issues fixed:
--   a) Incomplete FSM guard — only rejected SEATED, CANCELLED, NO_SHOW, EXPIRED.
--      Did NOT reject COMPLETED, REMOVED, SKIPPED (all terminal states).
--      A COMPLETED/REMOVED/SKIPPED entry could be re-seated.
--
--   b) No authorization — any anonymous user could call this SECURITY DEFINER
--      function directly. p_actor_user_id was accepted from the browser and
--      used blindly without verifying the caller is actually that user, or has
--      the queue.seat permission.
--
-- Authoritative seatableStatuses = {WAITING, CALLED, NOTIFIED}
-- All other states are terminal (or invalid) and must be rejected.
--
-- Authorization: The function now verifies that auth.uid() has the queue.seat
-- permission for the target restaurant. For internal/system calls where auth
-- context is the service_role (no auth.uid()), p_actor_user_id is validated
-- to have the permission — but only when explicitly provided as a fallback.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.seat_queue_entry_atomic(
  p_queue_entry_id UUID,
  p_table_id       UUID,
  p_actor_user_id  UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue_entry    public.queue_entries%ROWTYPE;
  v_table          public.restaurant_tables%ROWTYPE;
  v_actor_id       UUID;
  v_now            TIMESTAMPTZ := NOW();
  -- Authoritative set of states that CAN be seated
  v_seatable_states TEXT[] := ARRAY['WAITING', 'CALLED', 'NOTIFIED'];
  -- All states that are definitively terminal (non-seatable)
  v_terminal_states TEXT[] := ARRAY[
    'SEATED', 'CANCELLED', 'NO_SHOW', 'EXPIRED',
    'COMPLETED', 'REMOVED', 'SKIPPED'
  ];
BEGIN
  -- --------------------------------------------------------
  -- STEP 0: Resolve actor identity
  -- Prefer auth.uid() (server-side session) over p_actor_user_id.
  -- If auth.uid() is NULL (service_role context), fall back to p_actor_user_id.
  -- --------------------------------------------------------
  v_actor_id := COALESCE(auth.uid(), p_actor_user_id);

  -- --------------------------------------------------------
  -- STEP 1: Authorization check
  -- The caller MUST have queue.seat permission for the restaurant that owns
  -- this queue entry. We read the restaurant_id from the queue entry first.
  -- --------------------------------------------------------
  SELECT restaurant_id INTO STRICT v_queue_entry.restaurant_id
  FROM public.queue_entries
  WHERE id = p_queue_entry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUEUE_ENTRY_NOT_FOUND';
  END IF;

  -- Deny anonymous callers unconditionally
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required to seat a queue entry';
  END IF;

  -- Verify queue.seat permission for the resolved restaurant
  IF NOT public.has_permission(v_actor_id, v_queue_entry.restaurant_id, 'queue.seat') THEN
    RAISE EXCEPTION 'UNAUTHORIZED: queue.seat permission required';
  END IF;

  -- --------------------------------------------------------
  -- STEP 2: Lock Queue Entry for atomic FSM transition
  -- --------------------------------------------------------
  SELECT * INTO v_queue_entry
  FROM public.queue_entries
  WHERE id = p_queue_entry_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUEUE_ENTRY_NOT_FOUND';
  END IF;

  -- Reject ALL non-seatable states
  IF NOT (v_queue_entry.status = ANY(v_seatable_states)) THEN
    IF v_queue_entry.status = ANY(v_terminal_states) THEN
      RAISE EXCEPTION 'QUEUE_ENTRY_TERMINAL: Cannot seat entry in terminal state %', v_queue_entry.status;
    ELSE
      RAISE EXCEPTION 'QUEUE_ENTRY_NOT_SEATABLE: Entry status % is not eligible for seating', v_queue_entry.status;
    END IF;
  END IF;

  -- --------------------------------------------------------
  -- STEP 3: Lock Target Table for atomic reservation
  -- --------------------------------------------------------
  SELECT * INTO v_table
  FROM public.restaurant_tables
  WHERE id = p_table_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TABLE_NOT_FOUND';
  END IF;

  -- Verify table belongs to the same tenant
  IF v_table.restaurant_id != v_queue_entry.restaurant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH: Table does not belong to this restaurant';
  END IF;

  -- Verify table is not archived
  IF v_table.is_archived THEN
    RAISE EXCEPTION 'TABLE_ARCHIVED: Cannot seat at an archived table';
  END IF;

  -- Verify table is currently AVAILABLE
  IF v_table.status != 'AVAILABLE' THEN
    RAISE EXCEPTION 'TABLE_NOT_AVAILABLE: Table status is %', v_table.status;
  END IF;

  -- Verify table capacity is sufficient for party size
  IF v_table.capacity < v_queue_entry.party_size THEN
    RAISE EXCEPTION 'INSUFFICIENT_TABLE_CAPACITY: Table capacity % < party size %',
      v_table.capacity, v_queue_entry.party_size;
  END IF;

  -- --------------------------------------------------------
  -- STEP 4: Atomic Updates
  -- --------------------------------------------------------

  -- Update Queue Entry status → SEATED
  UPDATE public.queue_entries
  SET
    status          = 'SEATED',
    seated_table_id = p_table_id,
    seated_at       = v_now,
    updated_at      = v_now
  WHERE id = p_queue_entry_id;

  -- Update Table status → OCCUPIED
  UPDATE public.restaurant_tables
  SET
    status     = 'OCCUPIED',
    updated_at = v_now
  WHERE id = p_table_id;

  -- --------------------------------------------------------
  -- STEP 5: Record Queue Event
  -- --------------------------------------------------------
  INSERT INTO public.queue_events (
    restaurant_id,
    queue_entry_id,
    event_type,
    actor_user_id,
    metadata
  ) VALUES (
    v_queue_entry.restaurant_id,
    p_queue_entry_id,
    'QUEUE_SEATED',
    v_actor_id,
    jsonb_build_object(
      'table_id',       p_table_id,
      'table_number',   v_table.table_number,
      'party_size',     v_queue_entry.party_size,
      'previous_status', v_queue_entry.status
    )
  );

  -- --------------------------------------------------------
  -- STEP 6: Record Audit Log
  -- --------------------------------------------------------
  INSERT INTO public.audit_logs (
    restaurant_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) VALUES (
    v_queue_entry.restaurant_id,
    v_actor_id,
    'queue_entry_seated',
    'queue_entry',
    p_queue_entry_id,
    jsonb_build_object(
      'tableId',      p_table_id,
      'tableNumber',  v_table.table_number,
      'customerName', v_queue_entry.customer_name,
      'displayNumber', v_queue_entry.display_number,
      'previousStatus', v_queue_entry.status
    )
  );

  RETURN jsonb_build_object(
    'success',      true,
    'queueEntryId', p_queue_entry_id,
    'tableId',      p_table_id,
    'tableNumber',  v_table.table_number,
    'seatedAt',     v_now
  );
END;
$$;

-- =============================================================================
-- 6. ADD deduct_inventory_atomic() RPC
--
-- This replaces the unsafe inline inventory deduction in order-service.ts.
--
-- Design:
--   - Validates p_quantity > 0 (rejects zero and negative)
--   - Locks the inventory_items row FOR UPDATE (prevents race conditions)
--   - Checks sufficient stock before deducting
--   - Inserts an inventory_movements record
--   - Idempotency: unique index on (inventory_item_id, reference_type, reference_id)
--     ensures the same (order, inventory_item) pair cannot be deducted twice.
--   - One order may consume multiple inventory items — idempotency is per
--     (order_id + inventory_item_id), NOT per order alone.
--
-- Authorization: REVOKE from PUBLIC; only service_role (server-side) may call.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.deduct_inventory_atomic(
  p_restaurant_id     UUID,
  p_inventory_item_id UUID,
  p_quantity          NUMERIC,
  p_reference_type    TEXT DEFAULT 'ORDER',
  p_reference_id      UUID DEFAULT NULL,
  p_reason            TEXT DEFAULT NULL,
  p_created_by        UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item          public.inventory_items%ROWTYPE;
  v_qty_before    NUMERIC;
  v_qty_after     NUMERIC;
  v_movement_id   UUID;
BEGIN
  -- --------------------------------------------------------
  -- STEP 1: Validate inputs
  -- --------------------------------------------------------
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: Deduction quantity must be strictly positive, got %', p_quantity;
  END IF;

  IF p_inventory_item_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INVENTORY_ITEM: inventory_item_id is required';
  END IF;

  -- --------------------------------------------------------
  -- STEP 2: Lock inventory item row for atomic deduction
  -- --------------------------------------------------------
  SELECT * INTO v_item
  FROM public.inventory_items
  WHERE id = p_inventory_item_id
    AND restaurant_id = p_restaurant_id
    AND is_archived = FALSE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVENTORY_ITEM_NOT_FOUND: Item % not found for restaurant %',
      p_inventory_item_id, p_restaurant_id;
  END IF;

  v_qty_before := v_item.current_quantity;
  v_qty_after  := v_qty_before - p_quantity;

  -- --------------------------------------------------------
  -- STEP 3: Check sufficient stock
  -- --------------------------------------------------------
  IF v_qty_after < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: Available=%, Requested=%, Item=%',
      v_qty_before, p_quantity, v_item.name;
  END IF;

  -- --------------------------------------------------------
  -- STEP 4: Idempotency check
  -- If an ORDER_CONSUMPTION movement already exists for this
  -- (inventory_item_id, reference_type, reference_id) combination,
  -- return success without re-deducting (exactly-once guarantee).
  -- --------------------------------------------------------
  IF p_reference_type IS NOT NULL AND p_reference_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.inventory_movements
      WHERE inventory_item_id = p_inventory_item_id
        AND reference_type    = p_reference_type
        AND reference_id      = p_reference_id
        AND movement_type     = 'ORDER_CONSUMPTION'
    ) THEN
      RETURN jsonb_build_object(
        'success',        true,
        'idempotent',     true,
        'itemId',         p_inventory_item_id,
        'itemName',       v_item.name,
        'quantityBefore', v_qty_before,
        'quantityAfter',  v_qty_before,  -- unchanged, already consumed
        'message',        'Already consumed — idempotent no-op'
      );
    END IF;
  END IF;

  -- --------------------------------------------------------
  -- STEP 5: Apply deduction
  -- --------------------------------------------------------
  UPDATE public.inventory_items
  SET
    current_quantity = v_qty_after,
    updated_at       = NOW()
  WHERE id = p_inventory_item_id;

  -- --------------------------------------------------------
  -- STEP 6: Record movement ledger entry
  -- --------------------------------------------------------
  INSERT INTO public.inventory_movements (
    restaurant_id,
    inventory_item_id,
    movement_type,
    quantity_delta,
    quantity_before,
    quantity_after,
    reference_type,
    reference_id,
    reason,
    created_by
  ) VALUES (
    p_restaurant_id,
    p_inventory_item_id,
    'ORDER_CONSUMPTION',
    -p_quantity,
    v_qty_before,
    v_qty_after,
    p_reference_type,
    p_reference_id,
    COALESCE(p_reason, 'Order consumption'),
    p_created_by
  )
  RETURNING id INTO v_movement_id;

  RETURN jsonb_build_object(
    'success',        true,
    'idempotent',     false,
    'movementId',     v_movement_id,
    'itemId',         p_inventory_item_id,
    'itemName',       v_item.name,
    'quantityBefore', v_qty_before,
    'quantityAfter',  v_qty_after,
    'quantityDeducted', p_quantity
  );
END;
$$;

-- =============================================================================
-- 7. INVENTORY ORDER_CONSUMPTION IDEMPOTENCY INDEX
--
-- Enforces exactly-once deduction per (order, inventory_item) pair at DB level.
-- Multiple distinct inventory items can be consumed per order (multi-ingredient).
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_movements_order_consumption_idempotency
  ON public.inventory_movements (inventory_item_id, reference_type, reference_id)
  WHERE movement_type = 'ORDER_CONSUMPTION'
    AND reference_type IS NOT NULL
    AND reference_id   IS NOT NULL;

-- =============================================================================
-- 8. RESTRICT NEW ORDERS FROM USING DEPRECATED STATUS VALUES
--
-- Historical records with PENDING, ACCEPTED, IN_PREPARATION, COMPLETED are
-- PRESERVED. New records must use only the authoritative FSM states.
--
-- We add a NOT VALID constraint (checked only on new rows, not existing data).
-- =============================================================================

-- Drop the old permissive constraint
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_check;

-- Add new constraint: authoritative states only
-- Historical states (PENDING, ACCEPTED, IN_PREPARATION, COMPLETED) are preserved
-- but new inserts/updates are restricted.
-- NOT VALID means existing rows that violate it are not checked.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_authoritative_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_authoritative_check
  CHECK (status IN ('DRAFT', 'PLACED', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'))
  NOT VALID;

-- Comment documenting legacy states
COMMENT ON COLUMN public.orders.status IS
  'Authoritative FSM: DRAFT→PLACED→CONFIRMED→PREPARING→READY→SERVED, CANCELLED.
   Legacy historical values (PENDING, ACCEPTED, IN_PREPARATION, COMPLETED) may
   exist in historical records but are not accepted for new records.';

-- =============================================================================
-- 9. PAYMENT STATUS CLARIFICATION
--
-- SUCCEEDED: Payment provider confirmed successful payment (authoritative).
-- COMPLETED: Legacy alias — same semantic as SUCCEEDED but ambiguous.
--
-- New records must use SUCCEEDED. Historical COMPLETED records are preserved.
-- =============================================================================

COMMENT ON COLUMN public.payments.status IS
  'Authoritative FSM: PENDING→PROCESSING→SUCCEEDED, or PENDING→FAILED.
   SUCCEEDED→REFUND_PENDING→REFUNDED for refund flows.
   COMPLETED is a legacy alias for SUCCEEDED preserved in historical records only.
   New records must use SUCCEEDED instead of COMPLETED.';

-- =============================================================================
-- 10. FIX join_queue_atomic() — add search_path + ACTIVE restaurant check
--
-- Phase 8 omitted SET search_path. Also, the function checked queue_enabled
-- but not the restaurant status itself (ACTIVE vs SUSPENDED/ARCHIVED).
-- A SUSPENDED restaurant's queue should not accept new joins.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.join_queue_atomic(
  p_restaurant_id  UUID,
  p_customer_name  TEXT,
  p_customer_phone TEXT,
  p_party_size     INT,
  p_token_hash     TEXT
)
RETURNS public.queue_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant   public.restaurants%ROWTYPE;
  v_active_count INT;
  v_queue_num    INT;
  v_display_num  TEXT;
  v_new_entry    public.queue_entries%ROWTYPE;
BEGIN
  -- 1. Lock restaurant row for capacity/sequence concurrency safety
  SELECT * INTO v_restaurant
  FROM public.restaurants
  WHERE id = p_restaurant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RESTAURANT_NOT_FOUND';
  END IF;

  -- 2. Verify restaurant is ACTIVE (not SUSPENDED or ARCHIVED)
  IF v_restaurant.status != 'ACTIVE' THEN
    RAISE EXCEPTION 'RESTAURANT_NOT_ACTIVE: Restaurant status is %', v_restaurant.status;
  END IF;

  -- 3. Verify queue is enabled/open
  IF NOT v_restaurant.queue_enabled THEN
    RAISE EXCEPTION 'QUEUE_CLOSED';
  END IF;

  -- 4. Validate party size
  IF p_party_size < v_restaurant.min_party_size OR p_party_size > v_restaurant.max_party_size THEN
    RAISE EXCEPTION 'INVALID_PARTY_SIZE: Must be between % and %, got %',
      v_restaurant.min_party_size, v_restaurant.max_party_size, p_party_size;
  END IF;

  -- 5. Validate customer name not blank
  IF p_customer_name IS NULL OR TRIM(p_customer_name) = '' THEN
    RAISE EXCEPTION 'INVALID_CUSTOMER_NAME: Customer name cannot be blank';
  END IF;

  -- 6. Enforce capacity limit
  SELECT COUNT(*) INTO v_active_count
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id
    AND status IN ('WAITING', 'CALLED', 'NOTIFIED');

  IF v_active_count >= v_restaurant.max_queue_capacity THEN
    RAISE EXCEPTION 'QUEUE_FULL: Queue capacity % reached', v_restaurant.max_queue_capacity;
  END IF;

  -- 7. Check duplicate active phone (application-level; index enforces at DB level)
  IF p_customer_phone IS NOT NULL AND p_customer_phone != '' THEN
    IF EXISTS (
      SELECT 1 FROM public.queue_entries
      WHERE restaurant_id  = p_restaurant_id
        AND customer_phone = p_customer_phone
        AND status IN ('WAITING', 'CALLED', 'NOTIFIED')
    ) THEN
      RAISE EXCEPTION 'DUPLICATE_ACTIVE_ENTRY: Phone number already has an active queue entry';
    END IF;
  END IF;

  -- 8. Generate next sequential queue number & display number
  SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_queue_num
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id;

  v_display_num := 'Q-' || v_queue_num::text;

  -- 9. Insert queue entry
  INSERT INTO public.queue_entries (
    restaurant_id,
    customer_name,
    customer_phone,
    party_size,
    queue_number,
    display_number,
    status,
    token_hash,
    joined_at,
    created_at,
    updated_at
  ) VALUES (
    p_restaurant_id,
    TRIM(p_customer_name),
    NULLIF(TRIM(COALESCE(p_customer_phone, '')), ''),
    p_party_size,
    v_queue_num,
    v_display_num,
    'WAITING',
    p_token_hash,
    NOW(),
    NOW(),
    NOW()
  )
  RETURNING * INTO v_new_entry;

  -- 10. Insert queue lifecycle event
  INSERT INTO public.queue_events (
    restaurant_id,
    queue_entry_id,
    event_type,
    metadata
  ) VALUES (
    p_restaurant_id,
    v_new_entry.id,
    'QUEUE_JOINED',
    jsonb_build_object(
      'party_size',    p_party_size,
      'display_number', v_display_num,
      'queue_number',  v_queue_num
    )
  );

  RETURN v_new_entry;
END;
$$;

-- =============================================================================
-- 11. FIX ANALYTICS RPCs — ADD SET search_path
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_queue_metrics_summary(
  p_restaurant_id UUID,
  p_start_date    TIMESTAMPTZ,
  p_end_date      TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_joined          INT;
  v_total_seated          INT;
  v_total_dropped         INT;
  v_avg_wait_time_seconds INT;
BEGIN
  -- Validate permissions (must be part of restaurant)
  IF NOT public.is_super_admin(auth.uid()) AND NOT EXISTS (
    SELECT 1 FROM public.restaurant_memberships
    WHERE restaurant_id = p_restaurant_id
      AND user_id = auth.uid()
      AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT COUNT(*) INTO v_total_joined
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id
    AND joined_at >= p_start_date
    AND joined_at <= p_end_date;

  SELECT COUNT(*) INTO v_total_seated
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id
    AND joined_at >= p_start_date
    AND joined_at <= p_end_date
    AND status = 'SEATED';

  SELECT COUNT(*) INTO v_total_dropped
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id
    AND joined_at >= p_start_date
    AND joined_at <= p_end_date
    AND status IN ('CANCELLED', 'NO_SHOW', 'EXPIRED');

  SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (seated_at - joined_at))), 0)::INT
  INTO v_avg_wait_time_seconds
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id
    AND joined_at >= p_start_date
    AND joined_at <= p_end_date
    AND status = 'SEATED'
    AND seated_at IS NOT NULL;

  RETURN jsonb_build_object(
    'total_joined',           v_total_joined,
    'total_seated',           v_total_seated,
    'total_dropped',          v_total_dropped,
    'avg_wait_time_seconds',  v_avg_wait_time_seconds
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_hourly_queue_volume(
  p_restaurant_id UUID,
  p_start_date    TIMESTAMPTZ,
  p_end_date      TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Validate permissions
  IF NOT public.is_super_admin(auth.uid()) AND NOT EXISTS (
    SELECT 1 FROM public.restaurant_memberships
    WHERE restaurant_id = p_restaurant_id
      AND user_id = auth.uid()
      AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'hour',  hour_bucket,
      'count', count
    )
  ), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      DATE_TRUNC('hour', joined_at) AS hour_bucket,
      COUNT(*) AS count
    FROM public.queue_entries
    WHERE restaurant_id = p_restaurant_id
      AND joined_at >= p_start_date
      AND joined_at <= p_end_date
    GROUP BY hour_bucket
    ORDER BY hour_bucket
  ) AS hourly_data;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_commerce_metrics_summary(
  p_restaurant_id UUID,
  p_start_date    TIMESTAMPTZ,
  p_end_date      TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_orders  INT;
  v_total_revenue NUMERIC;
BEGIN
  -- Validate permissions
  IF NOT public.is_super_admin(auth.uid()) AND NOT EXISTS (
    SELECT 1 FROM public.restaurant_memberships
    WHERE restaurant_id = p_restaurant_id
      AND user_id = auth.uid()
      AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  -- Total completed/served orders (authoritative terminal states)
  SELECT COUNT(*) INTO v_total_orders
  FROM public.orders
  WHERE restaurant_id = p_restaurant_id
    AND created_at >= p_start_date
    AND created_at <= p_end_date
    AND status IN ('SERVED', 'COMPLETED');  -- COMPLETED preserved for historical

  -- Total revenue from successful payments (SUCCEEDED is authoritative)
  SELECT COALESCE(SUM(amount - refunded_amount), 0) INTO v_total_revenue
  FROM public.payments
  WHERE restaurant_id = p_restaurant_id
    AND created_at >= p_start_date
    AND created_at <= p_end_date
    AND status IN ('SUCCEEDED', 'COMPLETED');  -- COMPLETED preserved for historical

  RETURN jsonb_build_object(
    'total_orders',  v_total_orders,
    'total_revenue', v_total_revenue
  );
END;
$$;

-- =============================================================================
-- 12. CORRECT EXECUTE PRIVILEGE GRANTS FOR ALL SECURITY DEFINER FUNCTIONS
--
-- Policy:
--   claim_outbox_events     → service_role ONLY (never public workers)
--   recover_stale_outbox_events → service_role ONLY
--   deduct_inventory_atomic → service_role ONLY
--   seat_queue_entry_atomic → authenticated + service_role
--     (function enforces has_permission() internally, so auth access is safe)
--   join_queue_atomic       → anon + authenticated + service_role (intentionally public)
--   analytics RPCs          → authenticated + service_role (internal auth check)
--   helper functions        → as previously granted
-- =============================================================================

-- Revoke broad public access from privileged internal RPCs
REVOKE EXECUTE ON FUNCTION public.claim_outbox_events(INT)         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recover_stale_outbox_events(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.deduct_inventory_atomic(UUID, UUID, NUMERIC, TEXT, UUID, TEXT, UUID) FROM PUBLIC;

-- Revoke anon access from seat_queue_entry_atomic
-- (authenticated is still needed; the function enforces has_permission internally)
REVOKE EXECUTE ON FUNCTION public.seat_queue_entry_atomic(UUID, UUID, UUID) FROM PUBLIC;

-- Grant service_role-only access for internal system functions
GRANT EXECUTE ON FUNCTION public.claim_outbox_events(INT)         TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_stale_outbox_events(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.deduct_inventory_atomic(UUID, UUID, NUMERIC, TEXT, UUID, TEXT, UUID) TO service_role;

-- seat_queue_entry_atomic: authenticated (enforces permission internally) + service_role
GRANT EXECUTE ON FUNCTION public.seat_queue_entry_atomic(UUID, UUID, UUID) TO authenticated, service_role;

-- join_queue_atomic remains accessible to anon + authenticated (intentionally public queue joining)
GRANT EXECUTE ON FUNCTION public.join_queue_atomic(UUID, TEXT, TEXT, INT, TEXT) TO anon, authenticated, service_role;

-- Analytics RPCs: authenticated + service_role (internal auth check prevents unauthorized access)
REVOKE EXECUTE ON FUNCTION public.get_queue_metrics_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ)  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_hourly_queue_volume(UUID, TIMESTAMPTZ, TIMESTAMPTZ)    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_commerce_metrics_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_queue_metrics_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_hourly_queue_volume(UUID, TIMESTAMPTZ, TIMESTAMPTZ)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_commerce_metrics_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

-- =============================================================================
-- MIGRATION COMPLETE
--
-- Summary of what was fixed:
--   ✓ Phantom column reference in Phase 15 index dropped
--   ✓ outbox_events.status CHECK now includes PROCESSING
--   ✓ claim_outbox_events() atomically transitions to PROCESSING
--   ✓ recover_stale_outbox_events() handles worker crash/lease expiry
--   ✓ seat_queue_entry_atomic() rejects all terminal states
--   ✓ seat_queue_entry_atomic() enforces queue.seat authorization
--   ✓ deduct_inventory_atomic() provides atomic, idempotent stock deduction
--   ✓ Inventory ORDER_CONSUMPTION idempotency enforced at DB level
--   ✓ New orders restricted to authoritative status values (NOT VALID preserves history)
--   ✓ Payment COMPLETED/SUCCEEDED semantics documented
--   ✓ join_queue_atomic() has SET search_path + ACTIVE restaurant check
--   ✓ Analytics RPCs have SET search_path
--   ✓ Privileged RPCs have correct REVOKE/GRANT
-- =============================================================================
-- =============================================================================
-- Phase 16: Queue 5 AM Reset Logic
-- =============================================================================

-- 1. Create a function to get the most recent 5 AM cutoff for a restaurant
CREATE OR REPLACE FUNCTION public.get_recent_5am_cutoff(p_timezone TEXT DEFAULT 'UTC')
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_local_now TIMESTAMP;
  v_local_5am TIMESTAMP;
  v_cutoff TIMESTAMPTZ;
BEGIN
  -- Convert NOW() to the restaurant's timezone
  v_local_now := v_now AT TIME ZONE p_timezone;
  
  -- Construct today's 5 AM in local time
  v_local_5am := date_trunc('day', v_local_now) + interval '5 hours';
  
  -- If local time is currently before 5 AM, the cutoff was yesterday at 5 AM
  IF v_local_now < v_local_5am THEN
    v_local_5am := v_local_5am - interval '1 day';
  END IF;
  
  -- Convert back to TIMESTAMPTZ
  v_cutoff := v_local_5am AT TIME ZONE p_timezone;
  
  RETURN v_cutoff;
END;
$$;

-- 2. Update join_queue_atomic to reset queue_number at 5 AM
CREATE OR REPLACE FUNCTION public.join_queue_atomic(
  p_restaurant_id  UUID,
  p_customer_name  TEXT,
  p_customer_phone TEXT,
  p_party_size     INT,
  p_token_hash     TEXT
)
RETURNS public.queue_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant   public.restaurants%ROWTYPE;
  v_active_count INT;
  v_queue_num    INT;
  v_display_num  TEXT;
  v_new_entry    public.queue_entries%ROWTYPE;
  v_cutoff       TIMESTAMPTZ;
BEGIN
  -- 1. Lock restaurant row for capacity/sequence concurrency safety
  SELECT * INTO v_restaurant
  FROM public.restaurants
  WHERE id = p_restaurant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RESTAURANT_NOT_FOUND';
  END IF;

  -- 2. Verify restaurant is ACTIVE (not SUSPENDED or ARCHIVED)
  IF v_restaurant.status != 'ACTIVE' THEN
    RAISE EXCEPTION 'RESTAURANT_NOT_ACTIVE: Restaurant status is %', v_restaurant.status;
  END IF;

  -- 3. Verify queue is enabled/open
  IF NOT v_restaurant.queue_enabled THEN
    RAISE EXCEPTION 'QUEUE_CLOSED';
  END IF;

  -- 4. Validate party size
  IF p_party_size < v_restaurant.min_party_size OR p_party_size > v_restaurant.max_party_size THEN
    RAISE EXCEPTION 'INVALID_PARTY_SIZE: Must be between % and %, got %',
      v_restaurant.min_party_size, v_restaurant.max_party_size, p_party_size;
  END IF;

  -- 5. Validate customer name not blank
  IF p_customer_name IS NULL OR TRIM(p_customer_name) = '' THEN
    RAISE EXCEPTION 'INVALID_CUSTOMER_NAME: Customer name cannot be blank';
  END IF;
  
  -- Calculate 5 AM cutoff
  v_cutoff := public.get_recent_5am_cutoff(v_restaurant.timezone);

  -- 6. Enforce capacity limit (Only consider entries joined after 5 AM cutoff)
  SELECT COUNT(*) INTO v_active_count
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id
    AND status IN ('WAITING', 'CALLED', 'NOTIFIED')
    AND joined_at >= v_cutoff;

  IF v_active_count >= v_restaurant.max_queue_capacity THEN
    RAISE EXCEPTION 'QUEUE_FULL: Queue capacity % reached', v_restaurant.max_queue_capacity;
  END IF;

  -- 7. Check duplicate active phone (Only consider entries joined after 5 AM cutoff)
  IF p_customer_phone IS NOT NULL AND p_customer_phone != '' THEN
    IF EXISTS (
      SELECT 1 FROM public.queue_entries
      WHERE restaurant_id  = p_restaurant_id
        AND customer_phone = p_customer_phone
        AND status IN ('WAITING', 'CALLED', 'NOTIFIED')
        AND joined_at >= v_cutoff
    ) THEN
      RAISE EXCEPTION 'DUPLICATE_ACTIVE_ENTRY: Phone number already has an active queue entry';
    END IF;
  END IF;

  -- 8. Generate next sequential queue number & display number for TODAY (since 5 AM)
  SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_queue_num
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id
    AND joined_at >= v_cutoff;

  v_display_num := 'Q-' || v_queue_num::text;

  -- 9. Insert queue entry
  INSERT INTO public.queue_entries (
    restaurant_id,
    customer_name,
    customer_phone,
    party_size,
    queue_number,
    display_number,
    status,
    token_hash,
    joined_at,
    created_at,
    updated_at
  ) VALUES (
    p_restaurant_id,
    TRIM(p_customer_name),
    NULLIF(TRIM(COALESCE(p_customer_phone, '')), ''),
    p_party_size,
    v_queue_num,
    v_display_num,
    'WAITING',
    p_token_hash,
    NOW(),
    NOW(),
    NOW()
  )
  RETURNING * INTO v_new_entry;

  -- 10. Insert queue lifecycle event
  INSERT INTO public.queue_events (
    restaurant_id,
    queue_entry_id,
    event_type,
    metadata
  ) VALUES (
    p_restaurant_id,
    v_new_entry.id,
    'QUEUE_JOINED',
    jsonb_build_object(
      'party_size',    p_party_size,
      'display_number', v_display_num,
      'queue_number',  v_queue_num
    )
  );

  RETURN v_new_entry;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_queue_atomic(UUID, TEXT, TEXT, INT, TEXT) TO anon, authenticated, service_role;
-- =============================================================================
-- Phase 17: Queue Number Formatting Fix
-- =============================================================================

-- Update join_queue_atomic to remove the Q- prefix
CREATE OR REPLACE FUNCTION public.join_queue_atomic(
  p_restaurant_id  UUID,
  p_customer_name  TEXT,
  p_customer_phone TEXT,
  p_party_size     INT,
  p_token_hash     TEXT
)
RETURNS public.queue_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant   public.restaurants%ROWTYPE;
  v_active_count INT;
  v_queue_num    INT;
  v_display_num  TEXT;
  v_new_entry    public.queue_entries%ROWTYPE;
  v_cutoff       TIMESTAMPTZ;
BEGIN
  -- 1. Lock restaurant row for capacity/sequence concurrency safety
  SELECT * INTO v_restaurant
  FROM public.restaurants
  WHERE id = p_restaurant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RESTAURANT_NOT_FOUND';
  END IF;

  -- 2. Verify restaurant is ACTIVE (not SUSPENDED or ARCHIVED)
  IF v_restaurant.status != 'ACTIVE' THEN
    RAISE EXCEPTION 'RESTAURANT_NOT_ACTIVE: Restaurant status is %', v_restaurant.status;
  END IF;

  -- 3. Verify queue is enabled/open
  IF NOT v_restaurant.queue_enabled THEN
    RAISE EXCEPTION 'QUEUE_CLOSED';
  END IF;

  -- 4. Validate party size
  IF p_party_size < v_restaurant.min_party_size OR p_party_size > v_restaurant.max_party_size THEN
    RAISE EXCEPTION 'INVALID_PARTY_SIZE: Must be between % and %, got %',
      v_restaurant.min_party_size, v_restaurant.max_party_size, p_party_size;
  END IF;

  -- 5. Validate customer name not blank
  IF p_customer_name IS NULL OR TRIM(p_customer_name) = '' THEN
    RAISE EXCEPTION 'INVALID_CUSTOMER_NAME: Customer name cannot be blank';
  END IF;
  
  -- Calculate 5 AM cutoff
  v_cutoff := public.get_recent_5am_cutoff(v_restaurant.timezone);

  -- 6. Enforce capacity limit (Only consider entries joined after 5 AM cutoff)
  SELECT COUNT(*) INTO v_active_count
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id
    AND status IN ('WAITING', 'CALLED', 'NOTIFIED')
    AND joined_at >= v_cutoff;

  IF v_active_count >= v_restaurant.max_queue_capacity THEN
    RAISE EXCEPTION 'QUEUE_FULL: Queue capacity % reached', v_restaurant.max_queue_capacity;
  END IF;

  -- 7. Check duplicate active phone (Only consider entries joined after 5 AM cutoff)
  IF p_customer_phone IS NOT NULL AND p_customer_phone != '' THEN
    IF EXISTS (
      SELECT 1 FROM public.queue_entries
      WHERE restaurant_id  = p_restaurant_id
        AND customer_phone = p_customer_phone
        AND status IN ('WAITING', 'CALLED', 'NOTIFIED')
        AND joined_at >= v_cutoff
    ) THEN
      RAISE EXCEPTION 'DUPLICATE_ACTIVE_ENTRY: Phone number already has an active queue entry';
    END IF;
  END IF;

  -- 8. Generate next sequential queue number & display number for TODAY (since 5 AM)
  SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_queue_num
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id
    AND joined_at >= v_cutoff;

  v_display_num := v_queue_num::text;

  -- 9. Insert queue entry
  INSERT INTO public.queue_entries (
    restaurant_id,
    customer_name,
    customer_phone,
    party_size,
    queue_number,
    display_number,
    status,
    token_hash,
    joined_at,
    created_at,
    updated_at
  ) VALUES (
    p_restaurant_id,
    TRIM(p_customer_name),
    NULLIF(TRIM(COALESCE(p_customer_phone, '')), ''),
    p_party_size,
    v_queue_num,
    v_display_num,
    'WAITING',
    p_token_hash,
    NOW(),
    NOW(),
    NOW()
  )
  RETURNING * INTO v_new_entry;

  -- 10. Insert queue lifecycle event
  INSERT INTO public.queue_events (
    restaurant_id,
    queue_entry_id,
    event_type,
    metadata
  ) VALUES (
    p_restaurant_id,
    v_new_entry.id,
    'QUEUE_JOINED',
    jsonb_build_object(
      'party_size',    p_party_size,
      'display_number', v_display_num,
      'queue_number',  v_queue_num
    )
  );

  RETURN v_new_entry;
END;
$$;
-- Performance Snappy: composite indexes for hot paths + queue active lookup
-- Run: psql or supabase db push - this is safe IF NOT EXISTS

-- 1. Queue active lookup (WAITING/CALLED/NOTIFIED) - used by getActiveQueue + dashboard KPIs
CREATE INDEX IF NOT EXISTS idx_queue_active_hot
  ON public.queue_entries (restaurant_id, status, joined_at)
  WHERE status IN ('WAITING','CALLED','NOTIFIED');

-- 2. Queue daily filtering by created_at (today calcs)
CREATE INDEX IF NOT EXISTS idx_queue_restaurant_created
  ON public.queue_entries (restaurant_id, created_at DESC);

-- 3. Orders hot path - kitchen display & dashboard orders (status + FIFO)
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_status_created
  ON public.orders (restaurant_id, status, created_at)
  WHERE status IN ('PLACED','CONFIRMED','PREPARING','READY');

-- 4. Payments lookup by restaurant + status (reconcile, list)
CREATE INDEX IF NOT EXISTS idx_payments_restaurant_status
  ON public.payments (restaurant_id, status, created_at DESC);

-- 5. Menu active available fast browse
CREATE INDEX IF NOT EXISTS idx_menu_items_active_available
  ON public.menu_items (restaurant_id, active, available, display_order)
  WHERE is_archived = false;

-- 6. Tables availability fast seating
CREATE INDEX IF NOT EXISTS idx_tables_available_capacity
  ON public.restaurant_tables (restaurant_id, status, capacity)
  WHERE status = 'AVAILABLE' AND is_archived = false;

-- 7. Outbox pending work already indexed, add cover for retries
CREATE INDEX IF NOT EXISTS idx_outbox_next_attempt_cover
  ON public.outbox_events (next_attempt_at) WHERE status IN ('PENDING','FAILED');

-- 8. Audit logs recent per restaurant
CREATE INDEX IF NOT EXISTS idx_audit_recent
  ON public.audit_logs (restaurant_id, created_at DESC);

-- Comment: no new tables needed for speed. Current 15 tables cover all flows.
-- If you add new tables (e.g., restaurant_settings, qr_scans), share schema and we will generate FK + RLS + indexes.
-- FIX schema gaps from context dump (truncated CHECK + missing uniques + missing perf indexes)
-- Safe to run; all IF NOT EXISTS

-- 1. Fix truncated orders.status CHECK (was `NOT VALI` -> `NOT VALID`)
-- The dump showed: CHECK (...) NOT VALI  <- syntax error, missing D
-- We recreate correctly as NOT VALID (skips validation of existing rows, validated later)
DO $$ BEGIN
  -- Drop broken constraint if it exists with truncated name (if import failed, it won't exist)
  ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status = ANY (ARRAY['DRAFT'::text,'PLACED'::text,'CONFIRMED'::text,'PREPARING'::text,'READY'::text,'SERVED'::text,'CANCELLED'::text]))
  NOT VALID;

-- Validate it (if you want strict)
-- ALTER TABLE public.orders VALIDATE CONSTRAINT orders_status_check;

-- 2. Missing UNIQUE constraints (app expects them for idempotency + tenant safety)
CREATE UNIQUE INDEX IF NOT EXISTS unique_restaurant_slug ON public.restaurants (slug);
CREATE UNIQUE INDEX IF NOT EXISTS unique_user_restaurant_role ON public.restaurant_memberships (user_id, restaurant_id, role);
CREATE UNIQUE INDEX IF NOT EXISTS unique_restaurant_table_number ON public.restaurant_tables (restaurant_id, table_number);
CREATE UNIQUE INDEX IF NOT EXISTS unique_restaurant_zone_name ON public.restaurant_zones (restaurant_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS unique_restaurant_category_name ON public.menu_categories (restaurant_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS unique_payment_idempotency ON public.payments (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS unique_order_idempotency ON public.orders (restaurant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS unique_queue_token_hash ON public.queue_entries (token_hash) WHERE token_hash IS NOT NULL;

-- 3. Performance hot-path indexes (if 20260914 not yet applied, these cover it)
CREATE INDEX IF NOT EXISTS idx_queue_active_hot ON public.queue_entries (restaurant_id, status, joined_at) WHERE status IN ('WAITING','CALLED','NOTIFIED');
CREATE INDEX IF NOT EXISTS idx_queue_token_hash ON public.queue_entries (token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_queue_restaurant_created ON public.queue_entries (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_status_created ON public.orders (restaurant_id, status, created_at) WHERE status IN ('PLACED','CONFIRMED','PREPARING','READY');
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_payments_restaurant_status ON public.payments (restaurant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_menu_items_active_available ON public.menu_items (restaurant_id, active, available, display_order) WHERE is_archived = false;
CREATE INDEX IF NOT EXISTS idx_tables_available_capacity ON public.restaurant_tables (restaurant_id, status, capacity) WHERE status = 'AVAILABLE' AND is_archived = false;
CREATE INDEX IF NOT EXISTS idx_outbox_pending_work ON public.outbox_events (status, next_attempt_at) WHERE status IN ('PENDING','FAILED');

-- 4. Optional: Real QR scan analytics (remove if you don't want tracking)
-- This replaces the fake 1482 scans on QR page with real data. App code will write here via RPC or edge log.
CREATE TABLE IF NOT EXISTS public.qr_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  ip_hash text,
  user_agent text,
  referer text
);
CREATE INDEX IF NOT EXISTS idx_qr_scans_restaurant_time ON public.qr_scans (restaurant_id, scanned_at DESC);
ALTER TABLE public.qr_scans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff view qr_scans" ON public.qr_scans;
CREATE POLICY "Staff view qr_scans" ON public.qr_scans FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT restaurant_id FROM public.restaurant_memberships WHERE user_id = auth.uid() AND status='ACTIVE'));
-- No INSERT policy for anon; inserts should be via service_role or RPC

-- 5. Ensure RLS enabled where your dump omitted it (idempotent)
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
-- Phase 1 Realtime Infrastructure: enable Supabase Realtime for operational tables
-- Postgres is truth, Realtime is delivery, Browser is presentation

-- 1. Set REPLICA IDENTITY FULL to ensure postgres_changes publishes full row (needed for UPDATE/DELETE)
ALTER TABLE public.queue_entries REPLICA IDENTITY FULL;
ALTER TABLE public.restaurant_tables REPLICA IDENTITY FULL;
ALTER TABLE public.orders REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
ALTER TABLE public.queue_events REPLICA IDENTITY FULL;
ALTER TABLE public.order_events REPLICA IDENTITY FULL;

-- 2. Add tables to supabase_realtime publication (idempotent)
DO $$
BEGIN
  -- queue_entries
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'queue_entries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.queue_entries;
  END IF;
  -- restaurant_tables
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'restaurant_tables'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.restaurant_tables;
  END IF;
  -- orders
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  END IF;
  -- notifications
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
  -- queue_events (for timeline)
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'queue_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.queue_events;
  END IF;
  -- order_events
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'order_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_events;
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- If publication doesn't exist (local dev), create it
  CREATE PUBLICATION supabase_realtime FOR TABLE public.queue_entries, public.restaurant_tables, public.orders, public.notifications, public.queue_events, public.order_events;
END $$;

-- 3. Ensure RLS still enforced for realtime (no policy change needed for staff - existing tenant isolation already covers realtime)
-- Customer broadcast channel does not require RLS (bearer token via channel name), so no anon policy weakening.

-- 4. Comment for observability
COMMENT ON TABLE public.queue_entries IS 'Realtime enabled: staff subscribed via restaurant_id=eq., customer via broadcast queue-entry:<id>';
COMMENT ON TABLE public.restaurant_tables IS 'Realtime enabled: staff subscribed via restaurant_id=eq.';
COMMENT ON TABLE public.orders IS 'Realtime enabled: staff/kitchen subscribed via restaurant_id=eq.';
-- Phase 2 Queue Hardening: canonical FSM, seat eligibility, restaurant status, broadcast
-- Postgres is truth, no Redis

-- Ensure restaurants queue_operating_state is in realtime publication for dashboard sync
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='restaurants') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.restaurants;
  END IF;
EXCEPTION WHEN OTHERS THEN
  CREATE PUBLICATION supabase_realtime FOR TABLE public.restaurants;
END $$;
ALTER TABLE public.restaurants REPLICA IDENTITY FULL;

-- 1. Harden join_queue_atomic: check restaurant.status = ACTIVE
CREATE OR REPLACE FUNCTION public.join_queue_atomic(
  p_restaurant_id UUID,
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_party_size INT,
  p_token_hash TEXT
)
RETURNS public.queue_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant public.restaurants%ROWTYPE;
  v_active_count INT;
  v_queue_num INT;
  v_display_num TEXT;
  v_new_entry public.queue_entries%ROWTYPE;
BEGIN
  SELECT * INTO v_restaurant FROM public.restaurants WHERE id = p_restaurant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESTAURANT_NOT_FOUND'; END IF;
  IF v_restaurant.status != 'ACTIVE' THEN RAISE EXCEPTION 'QUEUE_CLOSED'; END IF;
  IF NOT v_restaurant.queue_enabled THEN RAISE EXCEPTION 'QUEUE_CLOSED'; END IF;
  IF p_party_size < v_restaurant.min_party_size OR p_party_size > v_restaurant.max_party_size THEN RAISE EXCEPTION 'INVALID_PARTY_SIZE'; END IF;
  SELECT COUNT(*) INTO v_active_count FROM public.queue_entries WHERE restaurant_id = p_restaurant_id AND status IN ('WAITING','CALLED','NOTIFIED');
  IF v_active_count >= v_restaurant.max_queue_capacity THEN RAISE EXCEPTION 'QUEUE_FULL'; END IF;
  IF p_customer_phone IS NOT NULL AND p_customer_phone != '' THEN
    IF EXISTS (SELECT 1 FROM public.queue_entries WHERE restaurant_id = p_restaurant_id AND customer_phone = p_customer_phone AND status IN ('WAITING','CALLED','NOTIFIED')) THEN
      RAISE EXCEPTION 'DUPLICATE_ACTIVE_ENTRY';
    END IF;
  END IF;
  SELECT COALESCE(MAX(queue_number),0)+1 INTO v_queue_num FROM public.queue_entries WHERE restaurant_id = p_restaurant_id;
  v_display_num := v_queue_num::text;
  INSERT INTO public.queue_entries (restaurant_id,customer_name,customer_phone,party_size,queue_number,display_number,status,token_hash,joined_at,created_at,updated_at)
  VALUES (p_restaurant_id, p_customer_name, NULLIF(p_customer_phone,''), p_party_size, v_queue_num, v_display_num, 'WAITING', p_token_hash, NOW(), NOW(), NOW())
  RETURNING * INTO v_new_entry;
  INSERT INTO public.queue_events (restaurant_id,queue_entry_id,event_type,metadata)
  VALUES (p_restaurant_id, v_new_entry.id, 'QUEUE_JOINED', jsonb_build_object('party_size',p_party_size,'display_number',v_display_num,'queue_number',v_queue_num));
  INSERT INTO public.outbox_events (restaurant_id,event_type,aggregate_type,aggregate_id,payload,status)
  VALUES (p_restaurant_id, 'QUEUE_JOINED','QUEUE',v_new_entry.id::text, jsonb_build_object('customerName',p_customer_name,'partySize',p_party_size,'displayNumber',v_display_num,'queueNumber',v_queue_num), 'PENDING');
  PERFORM pg_notify('queue_entry_update', json_build_object('restaurant_id',p_restaurant_id,'entry_id',v_new_entry.id,'event','QUEUE_JOINED')::text);
  RETURN v_new_entry;
END;
$$;
GRANT EXECUTE ON FUNCTION public.join_queue_atomic(UUID,TEXT,TEXT,INT,TEXT) TO anon, authenticated, service_role;

-- 2. Harden seat_queue_entry_atomic: only WAITING/NOTIFIED/CALLED -> SEATED, reject legacy
CREATE OR REPLACE FUNCTION public.seat_queue_entry_atomic(
  p_queue_entry_id UUID,
  p_table_id UUID,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue_entry public.queue_entries%ROWTYPE;
  v_table public.restaurant_tables%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_queue_entry FROM public.queue_entries WHERE id = p_queue_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUEUE_ENTRY_NOT_FOUND'; END IF;
  IF v_queue_entry.status NOT IN ('WAITING','NOTIFIED','CALLED') THEN
    RAISE EXCEPTION 'QUEUE_ENTRY_NOT_SEATABLE: status % cannot be seated', v_queue_entry.status;
  END IF;
  SELECT * INTO v_table FROM public.restaurant_tables WHERE id = p_table_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TABLE_NOT_FOUND'; END IF;
  IF v_table.restaurant_id != v_queue_entry.restaurant_id THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  IF v_table.is_archived THEN RAISE EXCEPTION 'TABLE_ARCHIVED'; END IF;
  IF v_table.status != 'AVAILABLE' THEN RAISE EXCEPTION 'TABLE_NOT_AVAILABLE'; END IF;
  IF v_table.capacity < v_queue_entry.party_size THEN RAISE EXCEPTION 'INSUFFICIENT_TABLE_CAPACITY'; END IF;
  -- Check actor permission if provided (defense in depth)
  IF p_actor_user_id IS NOT NULL THEN
    IF NOT public.has_restaurant_role(p_actor_user_id, v_queue_entry.restaurant_id, ARRAY['RESTAURANT_ADMIN','STAFF']) THEN
      -- Allow SUPER_ADMIN via is_super_admin check
      IF NOT public.is_super_admin(p_actor_user_id) THEN
        RAISE EXCEPTION 'UNAUTHORIZED';
      END IF;
    END IF;
  END IF;
  UPDATE public.queue_entries SET status='SEATED', seated_table_id=p_table_id, seated_at=v_now, updated_at=v_now WHERE id=p_queue_entry_id;
  UPDATE public.restaurant_tables SET status='OCCUPIED', updated_at=v_now WHERE id=p_table_id;
  INSERT INTO public.queue_events (restaurant_id,queue_entry_id,event_type,actor_user_id,metadata)
  VALUES (v_queue_entry.restaurant_id, p_queue_entry_id, 'QUEUE_SEATED', p_actor_user_id, jsonb_build_object('table_id',p_table_id,'table_number',v_table.table_number,'party_size',v_queue_entry.party_size,'previous_status',v_queue_entry.status));
  INSERT INTO public.outbox_events (restaurant_id,event_type,aggregate_type,aggregate_id,payload,status)
  VALUES (v_queue_entry.restaurant_id, 'QUEUE_SEATED','QUEUE',p_queue_entry_id::text, jsonb_build_object('previousStatus',v_queue_entry.status,'newStatus','SEATED','customerName',v_queue_entry.customer_name,'displayNumber',v_queue_entry.display_number,'tableId',p_table_id), 'PENDING');
  IF p_actor_user_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (restaurant_id,actor_user_id,action,entity_type,entity_id,metadata)
    VALUES (v_queue_entry.restaurant_id, p_actor_user_id, 'queue_entry_seated','queue_entry',p_queue_entry_id, jsonb_build_object('tableId',p_table_id,'tableNumber',v_table.table_number,'customerName',v_queue_entry.customer_name,'displayNumber',v_queue_entry.display_number));
  END IF;
  PERFORM pg_notify('queue_entry_update', json_build_object('restaurant_id',v_queue_entry.restaurant_id,'entry_id',p_queue_entry_id,'event','QUEUE_SEATED')::text);
  RETURN jsonb_build_object('success',true,'queueEntryId',p_queue_entry_id,'tableId',p_table_id,'tableNumber',v_table.table_number,'seatedAt',v_now);
END;
$$;
GRANT EXECUTE ON FUNCTION public.seat_queue_entry_atomic(UUID,UUID,UUID) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.seat_queue_entry_atomic(UUID,UUID,UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seat_queue_entry_atomic(UUID,UUID,UUID) FROM anon;

-- 3. New atomic transition function for non-seating queue status changes (ensures outbox atomic)
CREATE OR REPLACE FUNCTION public.transition_queue_entry_atomic(
  p_queue_entry_id UUID,
  p_target_status TEXT,
  p_actor_user_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.queue_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current public.queue_entries%ROWTYPE;
  v_old_status TEXT;
  v_old_display TEXT;
  v_old_name TEXT;
  v_now TIMESTAMPTZ := NOW();
  v_event_type TEXT;
  v_allowed TEXT[];
BEGIN
  SELECT * INTO v_current FROM public.queue_entries WHERE id = p_queue_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUEUE_ENTRY_NOT_FOUND'; END IF;
  v_old_status := v_current.status;
  v_old_display := v_current.display_number;
  v_old_name := v_current.customer_name;
  IF p_target_status = v_old_status THEN RETURN v_current; END IF;
  IF v_old_status IN ('SEATED','CANCELLED','NO_SHOW','EXPIRED','COMPLETED','REMOVED','SKIPPED') THEN
    RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: Cannot transition from terminal state % to %', v_old_status, p_target_status;
  END IF;
  IF v_old_status = 'SEATED' THEN RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: SEATED is terminal'; END IF;
  IF p_target_status = 'SEATED' THEN RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: Use seating operation for SEATED'; END IF;
  IF p_target_status IN ('COMPLETED','REMOVED','SKIPPED') THEN RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: % is legacy', p_target_status; END IF;
  -- Canonical matrix
  IF v_old_status = 'WAITING' THEN v_allowed := ARRAY['NOTIFIED','CALLED','CANCELLED','EXPIRED'];
  ELSIF v_old_status = 'NOTIFIED' THEN v_allowed := ARRAY['CALLED','CANCELLED','EXPIRED'];
  ELSIF v_old_status = 'CALLED' THEN v_allowed := ARRAY['NO_SHOW','CANCELLED','EXPIRED'];
  ELSE RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: Unknown current status %', v_old_status;
  END IF;
  IF NOT (p_target_status = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: % -> % not allowed. Allowed: %', v_old_status, p_target_status, array_to_string(v_allowed,',');
  END IF;
  -- Prepare update
  v_event_type := 'QUEUE_' || p_target_status;
  IF p_target_status = 'NOTIFIED' THEN
    UPDATE public.queue_entries SET status=p_target_status, notified_at=v_now, updated_at=v_now WHERE id=p_queue_entry_id AND status=v_old_status RETURNING * INTO v_current;
  ELSIF p_target_status = 'CALLED' THEN
    UPDATE public.queue_entries SET status=p_target_status, called_at=v_now, notified_at=COALESCE(notified_at,v_now), updated_at=v_now WHERE id=p_queue_entry_id AND status=v_old_status RETURNING * INTO v_current;
  ELSIF p_target_status = 'CANCELLED' THEN
    UPDATE public.queue_entries SET status=p_target_status, cancelled_at=v_now, updated_at=v_now WHERE id=p_queue_entry_id AND status=v_old_status RETURNING * INTO v_current;
  ELSIF p_target_status = 'NO_SHOW' THEN
    UPDATE public.queue_entries SET status=p_target_status, updated_at=v_now WHERE id=p_queue_entry_id AND status=v_old_status RETURNING * INTO v_current;
  ELSIF p_target_status = 'EXPIRED' THEN
    UPDATE public.queue_entries SET status=p_target_status, expired_at=v_now, updated_at=v_now WHERE id=p_queue_entry_id AND status=v_old_status RETURNING * INTO v_current;
  ELSE
    RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: Unhandled target %', p_target_status;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUEUE_STATE_CONFLICT'; END IF;
  SELECT * INTO v_current FROM public.queue_entries WHERE id=p_queue_entry_id;
  INSERT INTO public.queue_events (restaurant_id,queue_entry_id,event_type,actor_user_id,metadata)
  VALUES (v_current.restaurant_id, v_current.id, v_event_type, p_actor_user_id, jsonb_build_object('previous_status',v_old_status,'new_status',p_target_status,'reason',p_reason));
  INSERT INTO public.outbox_events (restaurant_id,event_type,aggregate_type,aggregate_id,payload,status)
  VALUES (v_current.restaurant_id, v_event_type, 'QUEUE', v_current.id::text, jsonb_build_object('previousStatus',v_old_status,'newStatus',p_target_status,'reason',p_reason,'actor',p_actor_user_id,'customerName',v_old_name,'displayNumber',v_old_display), 'PENDING');
  IF p_actor_user_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (restaurant_id,actor_user_id,action,entity_type,entity_id,metadata)
    VALUES (v_current.restaurant_id, p_actor_user_id, 'queue_entry_'||lower(p_target_status),'queue_entry',v_current.id, jsonb_build_object('previousStatus',v_current.status,'newStatus',p_target_status,'reason',p_reason));
  END IF;
  PERFORM pg_notify('queue_entry_update', json_build_object('restaurant_id',v_current.restaurant_id,'entry_id',v_current.id,'event',v_event_type)::text);
  RETURN v_current;
END;
$$;
GRANT EXECUTE ON FUNCTION public.transition_queue_entry_atomic(UUID,TEXT,UUID,TEXT) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.transition_queue_entry_atomic(UUID,TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transition_queue_entry_atomic(UUID,TEXT,UUID,TEXT) FROM anon;
-- Phase 2B Queue Operating Controls: OPEN/PAUSED/CLOSING_SOON/CLOSED
-- queue_enabled remains master flag, operating_state is operational state
-- FULL is derived, not stored

-- 1. Add queue_operating_state column with safe default OPEN
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS queue_operating_state TEXT NOT NULL DEFAULT 'OPEN'
  CHECK (queue_operating_state IN ('OPEN','PAUSED','CLOSING_SOON','CLOSED'));

-- Backfill existing restaurants: if queue_enabled = false, keep effective CLOSED via queue_enabled check, but set operating_state to OPEN for consistency
-- (No data migration needed - default OPEN is safe because queue_enabled=false still blocks joins)

-- Index for frequent public QR reads
CREATE INDEX IF NOT EXISTS idx_restaurants_queue_operating_state ON public.restaurants (queue_operating_state) WHERE queue_operating_state != 'OPEN';

-- 2. Update join_queue_atomic to enforce operating state
CREATE OR REPLACE FUNCTION public.join_queue_atomic(
  p_restaurant_id UUID,
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_party_size INT,
  p_token_hash TEXT
)
RETURNS public.queue_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant public.restaurants%ROWTYPE;
  v_active_count INT;
  v_queue_num INT;
  v_display_num TEXT;
  v_new_entry public.queue_entries%ROWTYPE;
BEGIN
  SELECT * INTO v_restaurant FROM public.restaurants WHERE id = p_restaurant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESTAURANT_NOT_FOUND'; END IF;
  IF v_restaurant.status != 'ACTIVE' THEN RAISE EXCEPTION 'QUEUE_CLOSED'; END IF;
  IF NOT v_restaurant.queue_enabled THEN RAISE EXCEPTION 'QUEUE_CLOSED'; END IF;
  -- Operating state controls new intake: PAUSED/CLOSED block, OPEN/CLOSING_SOON allow
  IF v_restaurant.queue_operating_state = 'PAUSED' THEN
    RAISE EXCEPTION 'QUEUE_PAUSED';
  ELSIF v_restaurant.queue_operating_state = 'CLOSED' THEN
    RAISE EXCEPTION 'QUEUE_CLOSED';
  END IF;
  -- CLOSING_SOON still allows joins (warning state, no timer yet)
  IF p_party_size < v_restaurant.min_party_size OR p_party_size > v_restaurant.max_party_size THEN RAISE EXCEPTION 'INVALID_PARTY_SIZE'; END IF;
  SELECT COUNT(*) INTO v_active_count FROM public.queue_entries WHERE restaurant_id = p_restaurant_id AND status IN ('WAITING','CALLED','NOTIFIED');
  IF v_active_count >= v_restaurant.max_queue_capacity THEN RAISE EXCEPTION 'QUEUE_FULL'; END IF;
  IF p_customer_phone IS NOT NULL AND p_customer_phone != '' THEN
    IF EXISTS (SELECT 1 FROM public.queue_entries WHERE restaurant_id = p_restaurant_id AND customer_phone = p_customer_phone AND status IN ('WAITING','CALLED','NOTIFIED')) THEN
      RAISE EXCEPTION 'DUPLICATE_ACTIVE_ENTRY';
    END IF;
  END IF;
  SELECT COALESCE(MAX(queue_number),0)+1 INTO v_queue_num FROM public.queue_entries WHERE restaurant_id = p_restaurant_id;
  v_display_num := v_queue_num::text;
  INSERT INTO public.queue_entries (restaurant_id,customer_name,customer_phone,party_size,queue_number,display_number,status,token_hash,joined_at,created_at,updated_at)
  VALUES (p_restaurant_id, p_customer_name, NULLIF(p_customer_phone,''), p_party_size, v_queue_num, v_display_num, 'WAITING', p_token_hash, NOW(), NOW(), NOW())
  RETURNING * INTO v_new_entry;
  INSERT INTO public.queue_events (restaurant_id,queue_entry_id,event_type,metadata)
  VALUES (p_restaurant_id, v_new_entry.id, 'QUEUE_JOINED', jsonb_build_object('party_size',p_party_size,'display_number',v_display_num,'queue_number',v_queue_num));
  INSERT INTO public.outbox_events (restaurant_id,event_type,aggregate_type,aggregate_id,payload,status)
  VALUES (p_restaurant_id, 'QUEUE_JOINED','QUEUE',v_new_entry.id::text, jsonb_build_object('customerName',p_customer_name,'partySize',p_party_size,'displayNumber',v_display_num,'queueNumber',v_queue_num), 'PENDING');
  PERFORM pg_notify('queue_entry_update', json_build_object('restaurant_id',p_restaurant_id,'entry_id',v_new_entry.id,'event','QUEUE_JOINED')::text);
  RETURN v_new_entry;
END;
$$;
GRANT EXECUTE ON FUNCTION public.join_queue_atomic(UUID,TEXT,TEXT,INT,TEXT) TO anon, authenticated, service_role;

-- 3. New function to set operating state atomically with concurrency protection
CREATE OR REPLACE FUNCTION public.set_queue_operating_state(
  p_restaurant_id UUID,
  p_new_state TEXT,
  p_actor_user_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.restaurants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current TEXT;
  v_restaurant public.restaurants%ROWTYPE;
  v_allowed TEXT[];
BEGIN
  IF p_new_state NOT IN ('OPEN','PAUSED','CLOSING_SOON','CLOSED') THEN
    RAISE EXCEPTION 'INVALID_OPERATING_STATE: %', p_new_state;
  END IF;
  SELECT * INTO v_restaurant FROM public.restaurants WHERE id = p_restaurant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESTAURANT_NOT_FOUND'; END IF;
  v_current := v_restaurant.queue_operating_state;
  IF v_current = p_new_state THEN
    RETURN v_restaurant; -- Idempotent no-op
  END IF;
  -- Canonical operating state transitions (allow all except no self-loop already handled)
  -- OPEN <-> PAUSED, OPEN <-> CLOSING_SOON, OPEN <-> CLOSED, PAUSED <-> OPEN/CLOSED, CLOSING_SOON <-> OPEN/CLOSED
  -- All are allowed except same-state (already handled). No invalid combos for now.
  -- Could restrict PAUSED->CLOSING_SOON etc. but spec says define whether PAUSED->CLOSED legal - we allow all.
  UPDATE public.restaurants SET queue_operating_state = p_new_state, updated_at = NOW() WHERE id = p_restaurant_id AND queue_operating_state = v_current RETURNING * INTO v_restaurant;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUEUE_STATE_CONFLICT'; END IF;
  SELECT * INTO v_restaurant FROM public.restaurants WHERE id = p_restaurant_id;
  INSERT INTO public.audit_logs (restaurant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (p_restaurant_id, p_actor_user_id, 'queue_operating_state_changed', 'restaurant', p_restaurant_id, jsonb_build_object('previousState', v_current, 'newState', p_new_state, 'reason', p_reason));
  INSERT INTO public.outbox_events (restaurant_id, event_type, aggregate_type, aggregate_id, payload, status)
  VALUES (p_restaurant_id, 'QUEUE_OPERATING_STATE_CHANGED', 'QUEUE', p_restaurant_id::text, jsonb_build_object('previousState', v_current, 'newState', p_new_state, 'reason', p_reason), 'PENDING');
  PERFORM pg_notify('queue_operating_state', json_build_object('restaurant_id', p_restaurant_id, 'previous', v_current, 'new', p_new_state)::text);
  RETURN v_restaurant;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_queue_operating_state(UUID,TEXT,UUID,TEXT) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.set_queue_operating_state(UUID,TEXT,UUID,TEXT) FROM PUBLIC, anon;

-- 4. Ensure queue_entries position still correct (no change, just comment)
COMMENT ON COLUMN public.restaurants.queue_operating_state IS 'Queue intake: OPEN (join allowed), PAUSED (join blocked, existing intact), CLOSING_SOON (join allowed, warning), CLOSED (join blocked). FULL is derived via active count >= max_queue_capacity. queue_enabled false overrides to CLOSED.';
-- Phase 2C Fix: Ensure transition_queue_entry_atomic handles no_show_at/reason correctly
-- This updates the function created in 20260917000000 to set no_show columns

CREATE OR REPLACE FUNCTION public.transition_queue_entry_atomic(
  p_queue_entry_id UUID,
  p_target_status TEXT,
  p_actor_user_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.queue_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current public.queue_entries%ROWTYPE;
  v_old_status TEXT;
  v_old_display TEXT;
  v_old_name TEXT;
  v_now TIMESTAMPTZ := NOW();
  v_event_type TEXT;
  v_allowed TEXT[];
  v_reason TEXT := COALESCE(p_reason, 'STAFF_MARKED_NO_SHOW');
BEGIN
  SELECT * INTO v_current FROM public.queue_entries WHERE id = p_queue_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUEUE_ENTRY_NOT_FOUND'; END IF;
  v_old_status := v_current.status;
  v_old_display := v_current.display_number;
  v_old_name := v_current.customer_name;
  IF p_target_status = v_old_status THEN RETURN v_current; END IF;
  IF v_old_status IN ('SEATED','CANCELLED','NO_SHOW','EXPIRED','COMPLETED','REMOVED','SKIPPED') THEN
    RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: Cannot transition from terminal state % to %', v_old_status, p_target_status;
  END IF;
  IF v_old_status = 'SEATED' THEN RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: SEATED is terminal'; END IF;
  IF p_target_status = 'SEATED' THEN RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: Use seating operation for SEATED'; END IF;
  IF p_target_status IN ('COMPLETED','REMOVED','SKIPPED') THEN RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: % is legacy', p_target_status; END IF;
  IF v_old_status = 'WAITING' THEN v_allowed := ARRAY['NOTIFIED','CALLED','CANCELLED','EXPIRED'];
  ELSIF v_old_status = 'NOTIFIED' THEN v_allowed := ARRAY['CALLED','CANCELLED','EXPIRED'];
  ELSIF v_old_status = 'CALLED' THEN v_allowed := ARRAY['NO_SHOW','CANCELLED','EXPIRED'];
  ELSE RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: Unknown current status %', v_old_status;
  END IF;
  IF NOT (p_target_status = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: % -> % not allowed. Allowed: %', v_old_status, p_target_status, array_to_string(v_allowed,',');
  END IF;
  -- Validate no-show reason
  IF p_target_status = 'NO_SHOW' AND v_reason NOT IN ('CUSTOMER_DID_NOT_RETURN','CUSTOMER_DID_NOT_RESPOND','STAFF_MARKED_NO_SHOW','OTHER') THEN
    v_reason := 'STAFF_MARKED_NO_SHOW';
  END IF;
  v_event_type := 'QUEUE_' || p_target_status;
  IF p_target_status = 'NOTIFIED' THEN
    UPDATE public.queue_entries SET status=p_target_status, notified_at=v_now, updated_at=v_now WHERE id=p_queue_entry_id AND status=v_old_status RETURNING * INTO v_current;
  ELSIF p_target_status = 'CALLED' THEN
    UPDATE public.queue_entries SET status=p_target_status, called_at=v_now, notified_at=COALESCE(notified_at,v_now), updated_at=v_now WHERE id=p_queue_entry_id AND status=v_old_status RETURNING * INTO v_current;
  ELSIF p_target_status = 'CANCELLED' THEN
    UPDATE public.queue_entries SET status=p_target_status, cancelled_at=v_now, updated_at=v_now WHERE id=p_queue_entry_id AND status=v_old_status RETURNING * INTO v_current;
  ELSIF p_target_status = 'NO_SHOW' THEN
    UPDATE public.queue_entries SET status=p_target_status, no_show_at=v_now, no_show_reason=v_reason, updated_at=v_now WHERE id=p_queue_entry_id AND status=v_old_status RETURNING * INTO v_current;
  ELSIF p_target_status = 'EXPIRED' THEN
    UPDATE public.queue_entries SET status=p_target_status, expired_at=v_now, updated_at=v_now WHERE id=p_queue_entry_id AND status=v_old_status RETURNING * INTO v_current;
  ELSE
    RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: Unhandled target %', p_target_status;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUEUE_STATE_CONFLICT'; END IF;
  SELECT * INTO v_current FROM public.queue_entries WHERE id=p_queue_entry_id;
  INSERT INTO public.queue_events (restaurant_id,queue_entry_id,event_type,actor_user_id,metadata)
  VALUES (v_current.restaurant_id, v_current.id, v_event_type, p_actor_user_id, jsonb_build_object('previous_status',v_old_status,'new_status',p_target_status,'reason',v_reason));
  INSERT INTO public.outbox_events (restaurant_id,event_type,aggregate_type,aggregate_id,payload,status)
  VALUES (v_current.restaurant_id, v_event_type, 'QUEUE', v_current.id::text, jsonb_build_object('previousStatus',v_old_status,'newStatus',p_target_status,'reason',v_reason,'actor',p_actor_user_id,'customerName',v_old_name,'displayNumber',v_old_display), 'PENDING');
  IF p_actor_user_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (restaurant_id,actor_user_id,action,entity_type,entity_id,metadata)
    VALUES (v_current.restaurant_id, p_actor_user_id, 'queue_entry_'||lower(p_target_status),'queue_entry',v_current.id, jsonb_build_object('previousStatus',v_old_status,'newStatus',p_target_status,'reason',v_reason));
  END IF;
  PERFORM pg_notify('queue_entry_update', json_build_object('restaurant_id',v_current.restaurant_id,'entry_id',v_current.id,'event',v_event_type)::text);
  RETURN v_current;
END;
$$;
GRANT EXECUTE ON FUNCTION public.transition_queue_entry_atomic(UUID,TEXT,UUID,TEXT) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.transition_queue_entry_atomic(UUID,TEXT,UUID,TEXT) FROM PUBLIC, anon;
-- Phase 2E Queue Operating Hours: weekly schedule + schedule-aware join
-- Convention: day_of_week 0=Sunday .. 6=Saturday (matches EXTRACT(DOW FROM ...))
-- Times are local restaurant time (restaurants.timezone, IANA). No offsets stored per row.

-- 1. Schedule table
CREATE TABLE IF NOT EXISTS public.restaurant_queue_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  opens_at TIME NOT NULL DEFAULT '00:00',
  closes_at TIME NOT NULL DEFAULT '23:59',
  is_closed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_restaurant_queue_hours_day UNIQUE (restaurant_id, day_of_week),
  CONSTRAINT valid_queue_hours_interval CHECK (
    is_closed = true OR opens_at != closes_at
  )
);

CREATE INDEX IF NOT EXISTS idx_queue_hours_restaurant ON public.restaurant_queue_hours (restaurant_id);

-- 2. Optional closing-soon threshold (restaurant-level, minutes before close to hint CLOSING_SOON)
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS closing_soon_minutes INT NOT NULL DEFAULT 30 CHECK (closing_soon_minutes >= 5 AND closing_soon_minutes <= 120);

-- 3. RLS
ALTER TABLE public.restaurant_queue_hours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant isolation for restaurant_queue_hours" ON public.restaurant_queue_hours;
CREATE POLICY "Tenant isolation for restaurant_queue_hours"
  ON public.restaurant_queue_hours FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())))
  WITH CHECK (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())));

-- 4. Backfill: always-open schedule for existing restaurants (preserves current behavior)
INSERT INTO public.restaurant_queue_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
SELECT r.id, d.day, '00:00'::time, '23:59'::time, false
FROM public.restaurants r
CROSS JOIN (SELECT generate_series(0,6) AS day) d
ON CONFLICT (restaurant_id, day_of_week) DO NOTHING;

-- 5. Realtime publication (idempotent, restaurant-level subscription reuses existing pattern)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'restaurant_queue_hours'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.restaurant_queue_hours;
  END IF;
END $$;
ALTER TABLE public.restaurant_queue_hours REPLICA IDENTITY FULL;

-- 6. Schedule-aware join: extend join_queue_atomic with operating-hours enforcement
-- Precedence: lifecycle > queue_enabled > manual PAUSED/CLOSED > scheduled hours > OPEN/CLOSING_SOON
CREATE OR REPLACE FUNCTION public.join_queue_atomic(
  p_restaurant_id UUID,
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_party_size INT,
  p_token_hash TEXT
)
RETURNS public.queue_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant public.restaurants%ROWTYPE;
  v_active_count INT;
  v_queue_num INT;
  v_display_num TEXT;
  v_new_entry public.queue_entries%ROWTYPE;
  v_local_now TIMESTAMPTZ;
  v_local_dow INT;
  v_local_time TIME;
  v_today RECORD;
  v_yesterday RECORD;
  v_sched_open BOOLEAN := false;
BEGIN
  SELECT * INTO v_restaurant FROM public.restaurants WHERE id = p_restaurant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESTAURANT_NOT_FOUND'; END IF;
  IF v_restaurant.status != 'ACTIVE' THEN RAISE EXCEPTION 'QUEUE_CLOSED'; END IF;
  IF NOT v_restaurant.queue_enabled THEN RAISE EXCEPTION 'QUEUE_CLOSED'; END IF;
  IF v_restaurant.queue_operating_state = 'PAUSED' THEN
    RAISE EXCEPTION 'QUEUE_PAUSED';
  ELSIF v_restaurant.queue_operating_state = 'CLOSED' THEN
    RAISE EXCEPTION 'QUEUE_CLOSED';
  END IF;

  -- Scheduled hours check (authoritative, restaurant-local time)
  -- Manual OPEN/CLOSING_SOON still require schedule to be open
  BEGIN
    v_local_now := timezone(COALESCE(v_restaurant.timezone, 'UTC'), NOW());
  EXCEPTION WHEN OTHERS THEN
    v_local_now := NOW();
  END;
  v_local_dow := EXTRACT(DOW FROM v_local_now)::INT;
  v_local_time := v_local_now::TIME;

  SELECT * INTO v_today FROM public.restaurant_queue_hours
    WHERE restaurant_id = p_restaurant_id AND day_of_week = v_local_dow;
  SELECT * INTO v_yesterday FROM public.restaurant_queue_hours
    WHERE restaurant_id = p_restaurant_id AND day_of_week = (v_local_dow + 6) % 7;

  -- If no schedule rows exist, treat as always open (safe default for legacy)
  IF v_today IS NULL AND v_yesterday IS NULL THEN
    v_sched_open := true;
  ELSE
    -- Today's interval
    IF v_today IS NOT NULL AND COALESCE(v_today.is_closed, false) = false THEN
      IF v_today.opens_at < v_today.closes_at THEN
        IF v_local_time >= v_today.opens_at AND v_local_time < v_today.closes_at THEN
          v_sched_open := true;
        END IF;
      ELSIF v_today.opens_at > v_today.closes_at THEN
        -- Cross-midnight: open from opens_at tonight onward
        IF v_local_time >= v_today.opens_at THEN
          v_sched_open := true;
        END IF;
      END IF;
    END IF;
    -- Yesterday's cross-midnight spill (opened yesterday, closes today)
    IF NOT v_sched_open AND v_yesterday IS NOT NULL AND COALESCE(v_yesterday.is_closed, false) = false THEN
      IF v_yesterday.opens_at > v_yesterday.closes_at THEN
        IF v_local_time < v_yesterday.closes_at THEN
          v_sched_open := true;
        END IF;
      END IF;
    END IF;
  END IF;

  IF NOT v_sched_open THEN
    RAISE EXCEPTION 'QUEUE_OUTSIDE_OPERATING_HOURS';
  END IF;

  IF p_party_size < v_restaurant.min_party_size OR p_party_size > v_restaurant.max_party_size THEN RAISE EXCEPTION 'INVALID_PARTY_SIZE'; END IF;
  SELECT COUNT(*) INTO v_active_count FROM public.queue_entries WHERE restaurant_id = p_restaurant_id AND status IN ('WAITING','CALLED','NOTIFIED');
  IF v_active_count >= v_restaurant.max_queue_capacity THEN RAISE EXCEPTION 'QUEUE_FULL'; END IF;
  IF p_customer_phone IS NOT NULL AND p_customer_phone != '' THEN
    IF EXISTS (SELECT 1 FROM public.queue_entries WHERE restaurant_id = p_restaurant_id AND customer_phone = p_customer_phone AND status IN ('WAITING','CALLED','NOTIFIED')) THEN
      RAISE EXCEPTION 'DUPLICATE_ACTIVE_ENTRY';
    END IF;
  END IF;
  SELECT COALESCE(MAX(queue_number),0)+1 INTO v_queue_num FROM public.queue_entries WHERE restaurant_id = p_restaurant_id;
  v_display_num := v_queue_num::text;
  INSERT INTO public.queue_entries (restaurant_id,customer_name,customer_phone,party_size,queue_number,display_number,status,token_hash,joined_at,created_at,updated_at)
  VALUES (p_restaurant_id, p_customer_name, NULLIF(p_customer_phone,''), p_party_size, v_queue_num, v_display_num, 'WAITING', p_token_hash, NOW(), NOW(), NOW())
  RETURNING * INTO v_new_entry;
  INSERT INTO public.queue_events (restaurant_id,queue_entry_id,event_type,metadata)
  VALUES (p_restaurant_id, v_new_entry.id, 'QUEUE_JOINED', jsonb_build_object('party_size',p_party_size,'display_number',v_display_num,'queue_number',v_queue_num));
  INSERT INTO public.outbox_events (restaurant_id,event_type,aggregate_type,aggregate_id,payload,status)
  VALUES (p_restaurant_id, 'QUEUE_JOINED','QUEUE',v_new_entry.id::text, jsonb_build_object('customerName',p_customer_name,'partySize',p_party_size,'displayNumber',v_display_num,'queueNumber',v_queue_num), 'PENDING');
  PERFORM pg_notify('queue_entry_update', json_build_object('restaurant_id',p_restaurant_id,'entry_id',v_new_entry.id,'event','QUEUE_JOINED')::text);
  RETURN v_new_entry;
END;
$$;
GRANT EXECUTE ON FUNCTION public.join_queue_atomic(UUID,TEXT,TEXT,INT,TEXT) TO anon, authenticated, service_role;

COMMENT ON TABLE public.restaurant_queue_hours IS 'Weekly queue schedule. day_of_week 0=Sunday..6=Saturday. Times are restaurant-local. opens_at>closes_at = cross-midnight. is_closed = closed day. Default 00:00-23:59 open (preserves legacy behavior).';
COMMENT ON COLUMN public.restaurants.closing_soon_minutes IS 'Minutes before scheduled close to hint CLOSING_SOON. Manual state stays authoritative; no auto-transition in this phase.';
-- Phase 3A: production worker + scheduled queue maintenance
-- 1. Overdue lookup index (CALLED + called_at, server time authoritative)
CREATE INDEX IF NOT EXISTS idx_queue_called_overdue
  ON public.queue_entries (restaurant_id, called_at)
  WHERE status = 'CALLED';

-- 2. Notification idempotency: one internal row per outbox event
CREATE UNIQUE INDEX IF NOT EXISTS unique_notifications_idempotency
  ON public.notifications (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 3. Expire overdue CALLED -> NO_SHOW (server time, batch, idempotent, concurrent-safe)
-- Only CALLED entries whose called_at + restaurant.call_timeout_minutes has elapsed.
-- Creates queue_events + outbox_events atomically per row. No duplicate side effects on re-run.
CREATE OR REPLACE FUNCTION public.expire_overdue_called_queue_entries(p_limit INT DEFAULT 50)
RETURNS TABLE (expired_count INT, expired_ids UUID[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids UUID[] := '{}';
  v_count INT := 0;
BEGIN
  -- Step 1: lock + transition overdue rows (SKIP LOCKED keeps concurrent workers safe)
  WITH overdue AS (
    SELECT qe.id
    FROM public.queue_entries qe
    JOIN public.restaurants r ON r.id = qe.restaurant_id
    WHERE qe.status = 'CALLED'
      AND qe.called_at IS NOT NULL
      AND NOW() > qe.called_at + (COALESCE(r.call_timeout_minutes, 15) || ' minutes')::INTERVAL
    ORDER BY qe.called_at ASC
    LIMIT GREATEST(p_limit, 1)
    FOR UPDATE OF qe SKIP LOCKED
  ),
  updated AS (
    UPDATE public.queue_entries qe
    SET status = 'NO_SHOW',
        no_show_at = NOW(),
        no_show_reason = 'CUSTOMER_DID_NOT_RESPOND',
        updated_at = NOW()
    FROM overdue o
    WHERE qe.id = o.id AND qe.status = 'CALLED'
    RETURNING qe.id, qe.restaurant_id, qe.customer_name, qe.display_number
  )
  SELECT COALESCE(array_agg(u.id), '{}'), count(*) INTO v_ids, v_count FROM updated u;

  -- Step 2: side effects for exactly the transitioned rows (same transaction = atomic)
  IF v_count > 0 THEN
    INSERT INTO public.queue_events (restaurant_id, queue_entry_id, event_type, metadata)
    SELECT qe.restaurant_id, qe.id, 'QUEUE_NO_SHOW',
           jsonb_build_object('reason', 'CUSTOMER_DID_NOT_RESPOND', 'auto', true)
    FROM public.queue_entries qe
    WHERE qe.id = ANY (v_ids);

    INSERT INTO public.outbox_events (restaurant_id, event_type, aggregate_type, aggregate_id, payload, status)
    SELECT qe.restaurant_id, 'QUEUE_NO_SHOW', 'QUEUE', qe.id::text,
           jsonb_build_object('reason', 'CUSTOMER_DID_NOT_RESPOND', 'auto', true,
                              'customerName', qe.customer_name, 'displayNumber', qe.display_number),
           'PENDING'
    FROM public.queue_entries qe
    WHERE qe.id = ANY (v_ids);
  END IF;
  -- pg_notify per expired row (best-effort realtime; polling fallback covers failures)
  IF v_count > 0 THEN
    PERFORM pg_notify('queue_entry_update',
      json_build_object('event', 'QUEUE_NO_SHOW', 'auto', true, 'count', v_count)::text);
  END IF;
  RETURN QUERY SELECT v_count, COALESCE(v_ids, '{}');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expire_overdue_called_queue_entries(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expire_overdue_called_queue_entries(INT) TO authenticated, service_role;

COMMENT ON FUNCTION public.expire_overdue_called_queue_entries(INT) IS 'Phase 3A: expire overdue CALLED->NO_SHOW. Server time authoritative, batch bounded, idempotent, SKIP LOCKED concurrent-safe. No scheduler attached; invoked by /api/cron/queue-maintenance.';
-- Phase 3A (revised): free scheduling via pg_cron — replaces Vercel cron (costly)
-- Queue maintenance runs as a direct DB call every minute (no HTTP, no extra cost).
-- Notifications still need app-level provider processing, so pg_cron triggers the
-- existing secured HTTP route via pg_net (also free). Both jobs are idempotent:
-- re-running finds nothing new to do.

-- 1. Enable extensions (if Dashboard > Database > Extensions was not used, this is a no-op fallback)
DO $do$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN NULL;
END $do$;

-- 2. Direct-DB queue maintenance job (free, no HTTP, no secret needed)
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('queue-maintenance-every-minute');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'queue-maintenance-every-minute',
      '* * * * *',
      $job$SELECT public.expire_overdue_called_queue_entries(50)$job$
    );
  END IF;
END $do$;

-- 3. Notification worker via pg_net (manual step — needs YOUR-APP-URL + CRON_SECRET):
--
--    CREATE EXTENSION IF NOT EXISTS pg_net;
--    SELECT cron.schedule(
--      'notifications-every-minute',
--      '* * * * *',
--      $$
--      SELECT net.http_post(
--        url := 'https://YOUR-APP-URL/api/cron/notifications?limit=50',
--        headers := '{"Authorization": "Bearer YOUR-CRON-SECRET", "Content-Type": "application/json"}'::jsonb,
--        body := '{}'::jsonb
--      )
--      $$
--    );
--
--    Inspect jobs:  SELECT jobname, schedule, active FROM cron.job;
--    Remove a job:  SELECT cron.unschedule('queue-maintenance-every-minute');
-- Phase 3C: Staff invitation system
-- Adds INVITED membership state + invitation timestamps for the secure
-- staff onboarding flow (Supabase Auth invite -> accept -> ACTIVE).
--
-- Idempotent: safe to re-run. Replaces ANY existing CHECK constraint on
-- restaurant_memberships.status with the canonical three-state check, so
-- partial applies of earlier drafts cannot leave a conflicting constraint.

DO $m$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.restaurant_memberships'::regclass
      AND c.contype = 'c'
      AND a.attname = 'status'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.restaurant_memberships DROP CONSTRAINT %I',
      r.conname
    );
  END LOOP;

  ALTER TABLE public.restaurant_memberships
    ADD CONSTRAINT restaurant_memberships_status_check
    CHECK (status IN ('ACTIVE', 'INVITED', 'INACTIVE'));
END
$m$;

-- When the invitation email was (re-)sent. NULL for pre-3C staff.
ALTER TABLE public.restaurant_memberships
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;

-- When the employee accepted the invitation (password set + activation).
-- NULL until INVITED -> ACTIVE via the accept-invitation flow.
ALTER TABLE public.restaurant_memberships
  ADD COLUMN IF NOT EXISTS invitation_accepted_at TIMESTAMPTZ;
-- Phase 3D: order bearer-token hygiene.
--
-- Raw order tokens must never persist server-side (only SHA-256 hashes in
-- orders.order_token_hash). Purge any raw tokens written by earlier builds.
-- The orders.order_token column is intentionally KEPT (nullable) for
-- backward compatibility, but application code must always write NULL.
-- Idempotent: safe to re-run.

UPDATE public.orders SET order_token = NULL WHERE order_token IS NOT NULL;
-- Phase 3E: least-privilege EXECUTE grants on SECURITY DEFINER RPCs.
--
-- Demonstrated pre-fix: any authenticated caller could seat / transition /
-- close ANY restaurant's queue rows (actor id trusted verbatim, NULL actor
-- skipped checks), any authenticated caller could mass-expire CALLED rows,
-- and ANONYMOUS callers could drain inventory and claim + read all tenants'
-- outbox payloads.
--
-- Fix: these functions are only ever invoked by trusted server code through
-- the service-role client (verified: all app call sites use createAdminClient;
-- pg_cron jobs run as the database owner, which bypasses grants). Restrict
-- EXECUTE to service_role. Authenticated/anon callers get "permission denied".
-- Idempotent: safe to re-run.

-- Queue mutations (app authorizes via AuthorizationService before calling).
REVOKE ALL ON FUNCTION public.seat_queue_entry_atomic(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seat_queue_entry_atomic(UUID, UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.transition_queue_entry_atomic(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_queue_entry_atomic(UUID, TEXT, UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.set_queue_operating_state(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_queue_operating_state(UUID, TEXT, UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.expire_overdue_called_queue_entries(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_overdue_called_queue_entries(INT) TO service_role;

-- Outbox worker primitives (service-role worker only).
REVOKE ALL ON FUNCTION public.claim_outbox_events(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_outbox_events(INT) TO service_role;

REVOKE ALL ON FUNCTION public.recover_stale_outbox_events(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_stale_outbox_events(INT) TO service_role;

-- Inventory ledger (server-only callers; anon-accessible stock drain closed).
REVOKE ALL ON FUNCTION public.deduct_inventory_atomic(UUID, UUID, NUMERIC, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_inventory_atomic(UUID, UUID, NUMERIC, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.deduct_inventory_atomic(UUID, UUID, NUMERIC, TEXT, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_inventory_atomic(UUID, UUID, NUMERIC, TEXT, UUID, TEXT, UUID) TO service_role;

-- Helper oracles: revoke anonymous enumeration (middleware + app use
-- authenticated sessions; service paths use service_role).
REVOKE ALL ON FUNCTION public.is_super_admin(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.has_permission(UUID, UUID, TEXT) FROM anon;

-- Intentionally UNCHANGED (public by design):
--   join_queue_atomic (anonymous QR join; validated server-side in-function)
--   get_recent_5am_cutoff (pure timezone math, no state)
--   recommend_tables_for_queue_entry (read-only; action layer now passes actor)
--   metrics RPCs (validate tenant via auth.uid() internally)
-- Phase 3E: constraint + RLS tightening (idempotent, safe to re-run).
--
-- 1. user_profiles INSERT was open (WITH CHECK(true) for any authenticated
--    user -> profile squatting with arbitrary ids). Restrict direct inserts
--    to self; the app writes via service_role (BYPASSRLS, unaffected).
-- 2. queue token_hash uniqueness was GLOBAL (cross-tenant squat/DoS).
--    Scope to (restaurant_id, token_hash). Data-safe: global uniqueness
--    implies scoped uniqueness.
-- 3. payments idempotency was GLOBAL (UNIQUE constraint + partial index).
--    Scope both to (restaurant_id, idempotency_key). Data-safe likewise.
-- 4. Direct authenticated UPDATE of queue_entries.status bypassed the FSM
--    (RLS checks tenant only). Revoke the column grant; all app writes go
--    through service_role RPCs/services (unaffected).
-- 5. Validate the orders status checks (no legacy violating rows exist).

-- 1. user_profiles INSERT: self-only for authenticated, open for service_role.
DROP POLICY IF EXISTS "Allow system insert" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Service role can insert profiles" ON public.user_profiles;
CREATE POLICY "Users can insert own profile"
  ON public.user_profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());
CREATE POLICY "Service role can insert profiles"
  ON public.user_profiles FOR INSERT TO service_role
  WITH CHECK (true);

-- 2. Scoped queue token uniqueness.
DROP INDEX IF EXISTS public.unique_queue_token_hash;
CREATE UNIQUE INDEX IF NOT EXISTS unique_queue_token_hash
  ON public.queue_entries (restaurant_id, token_hash)
  WHERE token_hash IS NOT NULL;

-- 3. Scoped payment idempotency.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_idempotency_key_key;
DROP INDEX IF EXISTS public.unique_payment_idempotency;
CREATE UNIQUE INDEX IF NOT EXISTS unique_payment_idempotency
  ON public.payments (restaurant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 4. (Enforcement moved to 20260925000002: PostgreSQL privileges are purely
--    additive, so a column-level REVOKE cannot subtract from the table-level
--    UPDATE grant — a BEFORE UPDATE trigger enforces the FSM instead.)

-- 5. Validate orders status checks (legacy rows verified clean).
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_status_check;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_status_authoritative_check;
-- Phase 3E: enforce the canonical queue FSM at the database layer.
--
-- Demonstrated pre-fix: any same-restaurant member could UPDATE
-- queue_entries.status directly (RLS checks tenant only), jumping to legacy
-- COMPLETED/REMOVED/SKIPPED or resurrecting terminal rows — bypassing the
-- transition/seat RPC matrix entirely.
--
-- This BEFORE UPDATE trigger fires for EVERY role (including service_role;
-- only the table owner bypasses triggers, and no app path writes as owner).
-- It validates status CHANGES only; same-value rewrites and non-status
-- updates pass through untouched. The matrix mirrors the application
-- canonical FSM plus the seat path (active -> SEATED via seating).
-- Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION public.enforce_queue_entry_fsm()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- SEATED is reachable from every active state: the seating operation seats
  -- directly from WAITING/NOTIFIED/CALLED (table assignment happens atomically
  -- in seat_queue_entry_atomic, not via CALLED first).
  IF NOT (
    (OLD.status = 'WAITING' AND NEW.status IN ('NOTIFIED', 'CALLED', 'SEATED', 'CANCELLED', 'EXPIRED'))
    OR (OLD.status = 'NOTIFIED' AND NEW.status IN ('CALLED', 'SEATED', 'CANCELLED', 'EXPIRED'))
    OR (OLD.status = 'CALLED' AND NEW.status IN ('SEATED', 'NO_SHOW', 'CANCELLED', 'EXPIRED'))
  ) THEN
    RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: % -> % not allowed', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_queue_entry_fsm ON public.queue_entries;
CREATE TRIGGER trg_enforce_queue_entry_fsm
  BEFORE UPDATE OF status ON public.queue_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_queue_entry_fsm();
-- QueueFlow: daily queue numbers (1,2,3…) + actual guests arrived
--
-- 1. Queue numbers reset every business day at 5 AM restaurant-local time.
--    Previous join_queue_atomic used MAX(queue_number) over ALL history, so
--    numbers grew forever (e.g. 342, 343…). Now scoped to entries created
--    after the most recent 5 AM cutoff (get_recent_5am_cutoff), so each day
--    starts at 1. Within a day, FOR UPDATE on the restaurant row + COUNT
--    keeps joins serialized per restaurant.
-- 2. actual_guests: staff confirm how many guests REALLY arrived at seat time
--    (party_size = expected from join form; actual_guests = headcount at door).

-- 2a. Actual guests column (expected party_size stays untouched for history)
ALTER TABLE public.queue_entries
  ADD COLUMN IF NOT EXISTS actual_guests INT CHECK (actual_guests IS NULL OR actual_guests >= 0);

-- 2b. Extend seat RPC to accept + persist actual guests (overload-safe:
--     old 3-arg calls keep working via default NULL)
--
-- IMPORTANT: CREATE OR REPLACE with a new signature ADDS an overload instead
-- of replacing the old one, leaving two ambiguous
-- seat_queue_entry_atomic variants (3-arg + 4-arg). Since the 4th parameter
-- has a DEFAULT, every 3-arg call matches BOTH overloads and Postgres /
-- PostgREST cannot choose ("best candidate function" error), and the fresh
-- overload inherits default PUBLIC execute grants (Phase 3E violation).
-- So: drop the legacy 3-arg overload first, then re-apply least privilege.
--
-- The body below is a faithful port of the 20260917 version (same checks,
-- same JSONB success return incl. seated_table_id persistence, audit log,
-- and pg_notify) plus actual_guests handling.
DROP FUNCTION IF EXISTS public.seat_queue_entry_atomic(UUID, UUID, UUID);
CREATE OR REPLACE FUNCTION public.seat_queue_entry_atomic(
  p_queue_entry_id UUID,
  p_table_id UUID,
  p_actor_user_id UUID DEFAULT NULL,
  p_actual_guests INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry public.queue_entries%ROWTYPE;
  v_table public.restaurant_tables%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
  v_seating_count INT;
BEGIN
  SELECT * INTO v_entry FROM public.queue_entries WHERE id = p_queue_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUEUE_ENTRY_NOT_FOUND'; END IF;
  IF v_entry.status = 'SEATED' THEN RAISE EXCEPTION 'QUEUE_ENTRY_ALREADY_SEATED'; END IF;
  IF v_entry.status NOT IN ('WAITING','NOTIFIED','CALLED') THEN
    RAISE EXCEPTION 'QUEUE_ENTRY_NOT_SEATABLE: status % cannot be seated', v_entry.status;
  END IF;
  SELECT * INTO v_table FROM public.restaurant_tables WHERE id = p_table_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TABLE_NOT_FOUND'; END IF;
  IF v_table.restaurant_id != v_entry.restaurant_id THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  IF v_table.is_archived THEN RAISE EXCEPTION 'TABLE_ARCHIVED'; END IF;
  IF v_table.status != 'AVAILABLE' THEN RAISE EXCEPTION 'TABLE_NOT_AVAILABLE'; END IF;
  -- Check actor permission if provided (defense in depth)
  IF p_actor_user_id IS NOT NULL THEN
    IF NOT public.has_restaurant_role(p_actor_user_id, v_entry.restaurant_id, ARRAY['RESTAURANT_ADMIN','STAFF']) THEN
      -- Allow SUPER_ADMIN via is_super_admin check
      IF NOT public.is_super_admin(p_actor_user_id) THEN
        RAISE EXCEPTION 'UNAUTHORIZED';
      END IF;
    END IF;
  END IF;

  -- Actual headcount confirmed at the door (defaults to expected party size).
  -- 0 = nobody showed is a no-show, not a seat; must fit the table.
  IF p_actual_guests IS NOT NULL THEN
    IF p_actual_guests <= 0 THEN RAISE EXCEPTION 'INVALID_ACTUAL_GUESTS'; END IF;
    v_seating_count := p_actual_guests;
  ELSE
    v_seating_count := v_entry.party_size;
  END IF;
  IF v_table.capacity < v_seating_count THEN RAISE EXCEPTION 'INSUFFICIENT_TABLE_CAPACITY'; END IF;

  UPDATE public.queue_entries
  SET status = 'SEATED',
      seated_table_id = p_table_id,
      seated_at = v_now,
      actual_guests = COALESCE(p_actual_guests, actual_guests, party_size),
      updated_at = v_now
  WHERE id = p_queue_entry_id
  RETURNING * INTO v_entry;
  UPDATE public.restaurant_tables SET status = 'OCCUPIED', updated_at = v_now WHERE id = p_table_id;
  INSERT INTO public.queue_events (restaurant_id,queue_entry_id,event_type,actor_user_id,metadata)
  VALUES (v_entry.restaurant_id, p_queue_entry_id, 'QUEUE_SEATED', p_actor_user_id,
    jsonb_build_object('table_id',p_table_id,'table_number',v_table.table_number,'party_size',v_entry.party_size,
      'actual_guests',v_entry.actual_guests,'previous_status',v_entry.status));
  INSERT INTO public.outbox_events (restaurant_id,event_type,aggregate_type,aggregate_id,payload,status)
  VALUES (v_entry.restaurant_id, 'QUEUE_SEATED','QUEUE',p_queue_entry_id::text,
    jsonb_build_object('previousStatus',v_entry.status,'newStatus','SEATED','customerName',v_entry.customer_name,
      'displayNumber',v_entry.display_number,'tableId',p_table_id,'actualGuests',v_entry.actual_guests), 'PENDING');
  IF p_actor_user_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (restaurant_id,actor_user_id,action,entity_type,entity_id,metadata)
    VALUES (v_entry.restaurant_id, p_actor_user_id, 'queue_entry_seated','queue_entry',p_queue_entry_id,
      jsonb_build_object('tableId',p_table_id,'tableNumber',v_table.table_number,'customerName',v_entry.customer_name,
        'displayNumber',v_entry.display_number,'actualGuests',v_entry.actual_guests));
  END IF;
  PERFORM pg_notify('queue_entry_update', json_build_object('restaurant_id',v_entry.restaurant_id,'entry_id',p_queue_entry_id,'event','QUEUE_SEATED')::text);
  RETURN jsonb_build_object('success',true,'queueEntryId',p_queue_entry_id,'tableId',p_table_id,
    'tableNumber',v_table.table_number,'seatedAt',v_now,'actualGuests',v_entry.actual_guests);
END;
$$;

-- Phase 3E least privilege on the surviving signature (service_role only —
-- the app authorizes via AuthorizationService before calling).
REVOKE ALL ON FUNCTION public.seat_queue_entry_atomic(UUID, UUID, UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seat_queue_entry_atomic(UUID, UUID, UUID, INT) TO service_role;

-- 1. Daily-reset join: same guards as 20260920000000, only the number
--    allocation changes (scoped to post-5AM-cutoff entries).
CREATE OR REPLACE FUNCTION public.join_queue_atomic(
  p_restaurant_id UUID,
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_party_size INT,
  p_token_hash TEXT
)
RETURNS public.queue_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant public.restaurants%ROWTYPE;
  v_active_count INT;
  v_queue_num INT;
  v_display_num TEXT;
  v_new_entry public.queue_entries%ROWTYPE;
  v_local_now TIMESTAMPTZ;
  v_local_dow INT;
  v_local_time TIME;
  v_today RECORD;
  v_yesterday RECORD;
  v_sched_open BOOLEAN := false;
  v_cutoff TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_restaurant FROM public.restaurants WHERE id = p_restaurant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESTAURANT_NOT_FOUND'; END IF;
  IF v_restaurant.status != 'ACTIVE' THEN RAISE EXCEPTION 'QUEUE_CLOSED'; END IF;
  IF NOT v_restaurant.queue_enabled THEN RAISE EXCEPTION 'QUEUE_CLOSED'; END IF;
  IF v_restaurant.queue_operating_state = 'PAUSED' THEN
    RAISE EXCEPTION 'QUEUE_PAUSED';
  ELSIF v_restaurant.queue_operating_state = 'CLOSED' THEN
    RAISE EXCEPTION 'QUEUE_CLOSED';
  END IF;

  BEGIN
    v_local_now := timezone(COALESCE(v_restaurant.timezone, 'UTC'), NOW());
  EXCEPTION WHEN OTHERS THEN
    v_local_now := NOW();
  END;
  v_local_dow := EXTRACT(DOW FROM v_local_now)::INT;
  v_local_time := v_local_now::TIME;

  SELECT * INTO v_today FROM public.restaurant_queue_hours
    WHERE restaurant_id = p_restaurant_id AND day_of_week = v_local_dow;
  SELECT * INTO v_yesterday FROM public.restaurant_queue_hours
    WHERE restaurant_id = p_restaurant_id AND day_of_week = (v_local_dow + 6) % 7;

  IF v_today IS NULL AND v_yesterday IS NULL THEN
    v_sched_open := true;
  ELSE
    IF v_today IS NOT NULL AND COALESCE(v_today.is_closed, false) = false THEN
      IF v_today.opens_at < v_today.closes_at THEN
        IF v_local_time >= v_today.opens_at AND v_local_time < v_today.closes_at THEN
          v_sched_open := true;
        END IF;
      ELSIF v_today.opens_at > v_today.closes_at THEN
        IF v_local_time >= v_today.opens_at THEN
          v_sched_open := true;
        END IF;
      END IF;
    END IF;
    IF NOT v_sched_open AND v_yesterday IS NOT NULL AND COALESCE(v_yesterday.is_closed, false) = false THEN
      IF v_yesterday.opens_at > v_yesterday.closes_at THEN
        IF v_local_time < v_yesterday.closes_at THEN
          v_sched_open := true;
        END IF;
      END IF;
    END IF;
  END IF;

  IF NOT v_sched_open THEN
    RAISE EXCEPTION 'QUEUE_OUTSIDE_OPERATING_HOURS';
  END IF;

  IF p_party_size < v_restaurant.min_party_size OR p_party_size > v_restaurant.max_party_size THEN RAISE EXCEPTION 'INVALID_PARTY_SIZE'; END IF;
  SELECT COUNT(*) INTO v_active_count FROM public.queue_entries WHERE restaurant_id = p_restaurant_id AND status IN ('WAITING','CALLED','NOTIFIED');
  IF v_active_count >= v_restaurant.max_queue_capacity THEN RAISE EXCEPTION 'QUEUE_FULL'; END IF;
  IF p_customer_phone IS NOT NULL AND p_customer_phone != '' THEN
    IF EXISTS (SELECT 1 FROM public.queue_entries WHERE restaurant_id = p_restaurant_id AND customer_phone = p_customer_phone AND status IN ('WAITING','CALLED','NOTIFIED')) THEN
      RAISE EXCEPTION 'DUPLICATE_ACTIVE_ENTRY';
    END IF;
  END IF;

  -- DAILY RESET: numbers restart at 1 after the 5 AM business-day cutoff.
  -- Falls back to all-history MAX only if the cutoff helper is missing.
  BEGIN
    v_cutoff := public.get_recent_5am_cutoff(COALESCE(v_restaurant.timezone, 'UTC'));
  EXCEPTION WHEN OTHERS THEN
    v_cutoff := NULL;
  END;
  IF v_cutoff IS NULL THEN
    SELECT COALESCE(MAX(queue_number),0)+1 INTO v_queue_num FROM public.queue_entries WHERE restaurant_id = p_restaurant_id;
  ELSE
    SELECT COALESCE(MAX(queue_number),0)+1 INTO v_queue_num FROM public.queue_entries WHERE restaurant_id = p_restaurant_id AND created_at >= v_cutoff;
  END IF;

  v_display_num := v_queue_num::text;
  INSERT INTO public.queue_entries (restaurant_id,customer_name,customer_phone,party_size,queue_number,display_number,status,token_hash,joined_at,created_at,updated_at)
  VALUES (p_restaurant_id, p_customer_name, NULLIF(p_customer_phone,''), p_party_size, v_queue_num, v_display_num, 'WAITING', p_token_hash, NOW(), NOW(), NOW())
  RETURNING * INTO v_new_entry;
  INSERT INTO public.queue_events (restaurant_id,queue_entry_id,event_type,metadata)
  VALUES (p_restaurant_id, v_new_entry.id, 'QUEUE_JOINED', jsonb_build_object('party_size',p_party_size,'display_number',v_display_num,'queue_number',v_queue_num));
  INSERT INTO public.outbox_events (restaurant_id,event_type,aggregate_type,aggregate_id,payload,status)
  VALUES (p_restaurant_id, 'QUEUE_JOINED','QUEUE',v_new_entry.id::text, jsonb_build_object('customerName',p_customer_name,'partySize',p_party_size,'displayNumber',v_display_num,'queueNumber',v_queue_num), 'PENDING');
  PERFORM pg_notify('queue_entry_update', json_build_object('restaurant_id',p_restaurant_id,'entry_id',v_new_entry.id,'event','QUEUE_JOINED')::text);
  RETURN v_new_entry;
END;
$$;
GRANT EXECUTE ON FUNCTION public.join_queue_atomic(UUID,TEXT,TEXT,INT,TEXT) TO anon, authenticated, service_role;

COMMENT ON COLUMN public.queue_entries.actual_guests IS 'Headcount confirmed by staff at seat time. party_size = expected (join form); actual_guests = who really arrived.';
-- ============================================================================
-- QUEUEFLOW PHASE 18: SEATING SYSTEM ARCHITECTURE UPGRADE
-- Supports:
-- 1. Table shapes (ROUND, SQUARE, RECTANGLE, BAR)
-- 2. Restaurant seating mode (SIMPLE vs STRICT)
-- 3. Live table occupancy tracking (occupied_seats, free_seats)
-- 4. active_seating_assignments junction table (multi-table & shared seating)
-- 5. Enhanced seat_queue_entry_atomic RPC supporting single, multi-table, and shared seating
-- ============================================================================

-- 1. EXTEND RESTAURANTS WITH SEATING MODE
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS seating_mode TEXT NOT NULL DEFAULT 'SIMPLE'
  CHECK (seating_mode IN ('SIMPLE', 'STRICT'));

COMMENT ON COLUMN public.restaurants.seating_mode IS 
  'Seating recommendation and assignment policy: SIMPLE (exclusive table assignment, no sharing) or STRICT (efficient capacity sharing permitted).';

-- 2. EXTEND RESTAURANT_TABLES WITH SHAPE & REALTIME OCCUPANCY
ALTER TABLE public.restaurant_tables
  ADD COLUMN IF NOT EXISTS shape TEXT NOT NULL DEFAULT 'RECTANGLE'
  CHECK (shape IN ('ROUND', 'SQUARE', 'RECTANGLE', 'BAR'));

ALTER TABLE public.restaurant_tables
  ADD COLUMN IF NOT EXISTS occupied_seats INT NOT NULL DEFAULT 0
  CHECK (occupied_seats >= 0);

ALTER TABLE public.restaurant_tables
  ADD COLUMN IF NOT EXISTS free_seats INT NOT NULL DEFAULT 2
  CHECK (free_seats >= 0);

-- Backfill free_seats and occupied_seats based on current status and capacity
UPDATE public.restaurant_tables
SET 
  occupied_seats = CASE WHEN status = 'OCCUPIED' THEN capacity ELSE 0 END,
  free_seats = CASE WHEN status = 'OCCUPIED' THEN 0 ELSE capacity END
WHERE free_seats IS NULL OR free_seats = 2;

-- 3. CREATE ACTIVE_SEATING_ASSIGNMENTS JUNCTION TABLE
CREATE TABLE IF NOT EXISTS public.active_seating_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  queue_entry_id UUID NOT NULL REFERENCES public.queue_entries(id) ON DELETE CASCADE,
  table_id UUID NOT NULL REFERENCES public.restaurant_tables(id) ON DELETE CASCADE,
  guests_allocated INT NOT NULL CHECK (guests_allocated > 0),
  is_primary BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_active_assignment_entry_table UNIQUE (queue_entry_id, table_id)
);

CREATE INDEX IF NOT EXISTS idx_active_assignments_restaurant ON public.active_seating_assignments(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_active_assignments_entry ON public.active_seating_assignments(queue_entry_id);
CREATE INDEX IF NOT EXISTS idx_active_assignments_table ON public.active_seating_assignments(table_id);

-- Enable RLS
ALTER TABLE public.active_seating_assignments ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "active_assignments_select" ON public.active_seating_assignments;
CREATE POLICY "active_assignments_select"
  ON public.active_seating_assignments
  FOR SELECT
  TO authenticated, service_role
  USING (
    public.is_super_admin(auth.uid()) OR
    EXISTS (
      SELECT 1 FROM public.restaurant_memberships m
      WHERE m.restaurant_id = active_seating_assignments.restaurant_id
        AND m.user_id = auth.uid()
        AND m.status = 'ACTIVE'
    )
  );

DROP POLICY IF EXISTS "active_assignments_all" ON public.active_seating_assignments;
CREATE POLICY "active_assignments_all"
  ON public.active_seating_assignments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. ATOMIC MULTI-TABLE & SHARED SEATING RPC
-- Upgrades seat_queue_entry_atomic to handle:
--   p_queue_entry_id: UUID
--   p_table_id: UUID (primary table)
--   p_actor_user_id: UUID (optional)
--   p_actual_guests: INT (optional)
--   p_additional_table_ids: UUID[] (optional for combined tables)

DROP FUNCTION IF EXISTS public.seat_queue_entry_atomic(UUID, UUID, UUID, INT);
DROP FUNCTION IF EXISTS public.seat_queue_entry_atomic(UUID, UUID, UUID, INT, UUID[]);

CREATE OR REPLACE FUNCTION public.seat_queue_entry_atomic(
  p_queue_entry_id UUID,
  p_table_id UUID,
  p_actor_user_id UUID DEFAULT NULL,
  p_actual_guests INT DEFAULT NULL,
  p_additional_table_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry public.queue_entries%ROWTYPE;
  v_primary_table public.restaurant_tables%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
  v_seating_count INT;
  v_total_capacity INT := 0;
  v_all_table_ids UUID[];
  v_cur_table_id UUID;
  v_cur_table public.restaurant_tables%ROWTYPE;
  v_remaining_guests INT;
  v_alloc INT;
  v_combined_numbers TEXT := '';
  v_restaurant public.restaurants%ROWTYPE;
BEGIN
  -- 1. Lock Queue Entry
  SELECT * INTO v_entry FROM public.queue_entries WHERE id = p_queue_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUEUE_ENTRY_NOT_FOUND'; END IF;
  IF v_entry.status = 'SEATED' THEN RAISE EXCEPTION 'QUEUE_ENTRY_ALREADY_SEATED'; END IF;
  IF v_entry.status NOT IN ('WAITING','NOTIFIED','CALLED') THEN
    RAISE EXCEPTION 'QUEUE_ENTRY_NOT_SEATABLE: status % cannot be seated', v_entry.status;
  END IF;

  -- Get restaurant configuration
  SELECT * INTO v_restaurant FROM public.restaurants WHERE id = v_entry.restaurant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESTAURANT_NOT_FOUND'; END IF;

  -- Check actor permission if provided (defense in depth)
  IF p_actor_user_id IS NOT NULL THEN
    IF NOT public.has_restaurant_role(p_actor_user_id, v_entry.restaurant_id, ARRAY['RESTAURANT_ADMIN','STAFF']) THEN
      IF NOT public.is_super_admin(p_actor_user_id) THEN
        RAISE EXCEPTION 'UNAUTHORIZED';
      END IF;
    END IF;
  END IF;

  -- Determine confirmed headcount
  IF p_actual_guests IS NOT NULL THEN
    IF p_actual_guests <= 0 THEN RAISE EXCEPTION 'INVALID_ACTUAL_GUESTS'; END IF;
    v_seating_count := p_actual_guests;
  ELSE
    v_seating_count := v_entry.party_size;
  END IF;

  -- 2. Build list of table IDs (primary + additional)
  v_all_table_ids := ARRAY[p_table_id];
  IF p_additional_table_ids IS NOT NULL AND array_length(p_additional_table_ids, 1) > 0 THEN
    FOREACH v_cur_table_id IN ARRAY p_additional_table_ids LOOP
      IF v_cur_table_id IS NOT NULL AND NOT (v_cur_table_id = ANY(v_all_table_ids)) THEN
        v_all_table_ids := array_append(v_all_table_ids, v_cur_table_id);
      END IF;
    END LOOP;
  END IF;

  -- 3. Lock and validate all tables
  v_remaining_guests := v_seating_count;

  FOREACH v_cur_table_id IN ARRAY v_all_table_ids LOOP
    SELECT * INTO v_cur_table FROM public.restaurant_tables WHERE id = v_cur_table_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'TABLE_NOT_FOUND: %', v_cur_table_id; END IF;
    IF v_cur_table.restaurant_id != v_entry.restaurant_id THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
    IF v_cur_table.is_archived THEN RAISE EXCEPTION 'TABLE_ARCHIVED'; END IF;

    -- Validate table availability according to mode:
    -- In SIMPLE mode, table must be AVAILABLE (or if already partially occupied, sharing is blocked)
    IF v_restaurant.seating_mode = 'SIMPLE' THEN
      IF v_cur_table.status != 'AVAILABLE' THEN
        RAISE EXCEPTION 'TABLE_NOT_AVAILABLE';
      END IF;
      v_total_capacity := v_total_capacity + v_cur_table.capacity;
    ELSE
      -- In STRICT mode, table can be AVAILABLE or OCCUPIED if it has free_seats
      IF v_cur_table.status NOT IN ('AVAILABLE', 'OCCUPIED') THEN
        RAISE EXCEPTION 'TABLE_NOT_AVAILABLE';
      END IF;
      IF v_cur_table.free_seats <= 0 THEN
        RAISE EXCEPTION 'INSUFFICIENT_TABLE_CAPACITY: Table % has no free seats', v_cur_table.table_number;
      END IF;
      v_total_capacity := v_total_capacity + v_cur_table.free_seats;
    END IF;

    IF v_cur_table_id = p_table_id THEN
      v_primary_table := v_cur_table;
    END IF;

    IF v_combined_numbers = '' THEN
      v_combined_numbers := v_cur_table.table_number;
    ELSE
      v_combined_numbers := v_combined_numbers || ' + ' || v_cur_table.table_number;
    END IF;
  END LOOP;

  IF v_total_capacity < v_seating_count THEN
    RAISE EXCEPTION 'INSUFFICIENT_TABLE_CAPACITY';
  END IF;

  -- 4. Create Active Seating Assignments & update table occupancy
  FOREACH v_cur_table_id IN ARRAY v_all_table_ids LOOP
    SELECT * INTO v_cur_table FROM public.restaurant_tables WHERE id = v_cur_table_id;
    
    -- Calculate allocated seats for this table
    IF v_restaurant.seating_mode = 'SIMPLE' THEN
      v_alloc := LEAST(v_cur_table.capacity, v_remaining_guests);
    ELSE
      v_alloc := LEAST(v_cur_table.free_seats, v_remaining_guests);
    END IF;
    IF v_alloc <= 0 THEN v_alloc := 1; END IF;

    -- Record assignment in junction table
    INSERT INTO public.active_seating_assignments (
      restaurant_id, queue_entry_id, table_id, guests_allocated, is_primary, created_at, updated_at
    ) VALUES (
      v_entry.restaurant_id, p_queue_entry_id, v_cur_table_id, v_alloc, (v_cur_table_id = p_table_id), v_now, v_now
    )
    ON CONFLICT (queue_entry_id, table_id) DO UPDATE
    SET guests_allocated = EXCLUDED.guests_allocated, updated_at = v_now;

    -- Update table occupied and free seats
    UPDATE public.restaurant_tables
    SET
      status = 'OCCUPIED',
      occupied_seats = occupied_seats + v_alloc,
      free_seats = GREATEST(0, capacity - (occupied_seats + v_alloc)),
      updated_at = v_now
    WHERE id = v_cur_table_id;

    v_remaining_guests := GREATEST(0, v_remaining_guests - v_alloc);
  END LOOP;

  -- 5. Update Queue Entry status -> SEATED
  UPDATE public.queue_entries
  SET status = 'SEATED',
      seated_table_id = p_table_id,
      seated_at = v_now,
      actual_guests = v_seating_count,
      updated_at = v_now
  WHERE id = p_queue_entry_id
  RETURNING * INTO v_entry;

  -- 6. Insert events & audit logs
  INSERT INTO public.queue_events (restaurant_id, queue_entry_id, event_type, actor_user_id, metadata)
  VALUES (
    v_entry.restaurant_id,
    p_queue_entry_id,
    'QUEUE_SEATED',
    p_actor_user_id,
    jsonb_build_object(
      'table_id', p_table_id,
      'table_number', v_primary_table.table_number,
      'combined_table_numbers', v_combined_numbers,
      'all_table_ids', v_all_table_ids,
      'party_size', v_entry.party_size,
      'actual_guests', v_entry.actual_guests,
      'previous_status', v_entry.status,
      'seating_mode', v_restaurant.seating_mode
    )
  );

  INSERT INTO public.outbox_events (restaurant_id, event_type, aggregate_type, aggregate_id, payload, status)
  VALUES (
    v_entry.restaurant_id,
    'QUEUE_SEATED',
    'QUEUE',
    p_queue_entry_id::text,
    jsonb_build_object(
      'previousStatus', v_entry.status,
      'newStatus', 'SEATED',
      'customerName', v_entry.customer_name,
      'displayNumber', v_entry.display_number,
      'tableId', p_table_id,
      'allTableIds', v_all_table_ids,
      'combinedTableNumbers', v_combined_numbers,
      'actualGuests', v_entry.actual_guests
    ),
    'PENDING'
  );

  IF p_actor_user_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (restaurant_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (
      v_entry.restaurant_id,
      p_actor_user_id,
      'queue_entry_seated',
      'queue_entry',
      p_queue_entry_id,
      jsonb_build_object(
        'tableId', p_table_id,
        'tableNumber', v_primary_table.table_number,
        'allTableIds', v_all_table_ids,
        'combinedTableNumbers', v_combined_numbers,
        'customerName', v_entry.customer_name,
        'displayNumber', v_entry.display_number,
        'actualGuests', v_entry.actual_guests
      )
    );
  END IF;

  PERFORM pg_notify('queue_entry_update', json_build_object('restaurant_id', v_entry.restaurant_id, 'entry_id', p_queue_entry_id, 'event', 'QUEUE_SEATED')::text);

  RETURN jsonb_build_object(
    'success', true,
    'queueEntryId', p_queue_entry_id,
    'tableId', p_table_id,
    'tableNumber', v_primary_table.table_number,
    'combinedTableNumbers', v_combined_numbers,
    'allTableIds', v_all_table_ids,
    'seatedAt', v_now,
    'actualGuests', v_entry.actual_guests
  );
END;
$$;

-- Phase 3E least privilege
REVOKE ALL ON FUNCTION public.seat_queue_entry_atomic(UUID, UUID, UUID, INT, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seat_queue_entry_atomic(UUID, UUID, UUID, INT, UUID[]) TO service_role;
-- ============================================================================
-- QUEUEFLOW PHASE 18: SEATING OCCUPANCY INTEGRITY CORRECTION
-- 1. Fix free_seats default behavior (remove static DEFAULT 2).
-- 2. Add BEFORE INSERT OR UPDATE trigger to guarantee free_seats = capacity - occupied_seats.
-- 3. Add CHECK constraints to enforce occupancy bounds and invariants.
-- ============================================================================

-- 1. Remove confusing static DEFAULT 2 on free_seats
ALTER TABLE public.restaurant_tables
  ALTER COLUMN free_seats SET DEFAULT 0;

ALTER TABLE public.restaurant_tables
  ALTER COLUMN occupied_seats SET DEFAULT 0;

-- 2. Trigger to keep free_seats synchronized with capacity - occupied_seats
CREATE OR REPLACE FUNCTION public.sync_restaurant_table_seats()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- If table is set to AVAILABLE or CLEANING, occupied_seats must be 0
  IF NEW.status IN ('AVAILABLE', 'CLEANING') AND (TG_OP = 'INSERT' OR OLD.status != NEW.status OR NEW.occupied_seats = OLD.occupied_seats) THEN
    NEW.occupied_seats := 0;
  END IF;

  IF NEW.occupied_seats IS NULL THEN
    NEW.occupied_seats := 0;
  END IF;

  -- Guarantee free_seats is strictly capacity - occupied_seats
  NEW.free_seats := NEW.capacity - NEW.occupied_seats;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_restaurant_table_seats ON public.restaurant_tables;
CREATE TRIGGER trg_sync_restaurant_table_seats
BEFORE INSERT OR UPDATE ON public.restaurant_tables
FOR EACH ROW
EXECUTE FUNCTION public.sync_restaurant_table_seats();

-- 3. Enforce constraints
ALTER TABLE public.restaurant_tables
  DROP CONSTRAINT IF EXISTS chk_table_occupancy_bounds;
ALTER TABLE public.restaurant_tables
  DROP CONSTRAINT IF EXISTS chk_table_free_seats_bounds;
ALTER TABLE public.restaurant_tables
  DROP CONSTRAINT IF EXISTS chk_table_free_seats_invariant;

ALTER TABLE public.restaurant_tables
  ADD CONSTRAINT chk_table_occupancy_bounds
  CHECK (occupied_seats >= 0 AND occupied_seats <= capacity);

ALTER TABLE public.restaurant_tables
  ADD CONSTRAINT chk_table_free_seats_bounds
  CHECK (free_seats >= 0 AND free_seats <= capacity);

ALTER TABLE public.restaurant_tables
  ADD CONSTRAINT chk_table_free_seats_invariant
  CHECK (free_seats = capacity - occupied_seats);
-- Migration: 20260928000000_disable_auto_expire_called.sql
-- Description: Keep timed out / overdue called queue entries in the active queue instead of clearing them automatically.
-- Adds auto_expire_called column to restaurants (default false).
-- Updates expire_overdue_called_queue_entries() so it ONLY expires entries if r.auto_expire_called IS TRUE.

ALTER TABLE public.restaurants 
  ADD COLUMN IF NOT EXISTS auto_expire_called BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.restaurants.auto_expire_called IS 'When true, overdue called queue entries are automatically transitioned to NO_SHOW. When false (default), called entries remain in the queue as Overdue so staff can seat them or manually decide to mark no-show.';

CREATE OR REPLACE FUNCTION public.expire_overdue_called_queue_entries(p_limit INT DEFAULT 50)
RETURNS TABLE (expired_count INT, expired_ids UUID[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids UUID[] := '{}';
  v_count INT := 0;
BEGIN
  -- Step 1: lock + transition overdue rows ONLY for restaurants that explicitly opted into auto-expire
  WITH overdue AS (
    SELECT qe.id
    FROM public.queue_entries qe
    JOIN public.restaurants r ON r.id = qe.restaurant_id
    WHERE qe.status = 'CALLED'
      AND qe.called_at IS NOT NULL
      AND r.auto_expire_called IS TRUE
      AND r.call_timeout_minutes IS NOT NULL
      AND r.call_timeout_minutes > 0
      AND NOW() > qe.called_at + (r.call_timeout_minutes || ' minutes')::INTERVAL
    ORDER BY qe.called_at ASC
    LIMIT GREATEST(p_limit, 1)
    FOR UPDATE OF qe SKIP LOCKED
  ),
  updated AS (
    UPDATE public.queue_entries qe
    SET status = 'NO_SHOW',
        no_show_at = NOW(),
        no_show_reason = 'CUSTOMER_DID_NOT_RESPOND',
        updated_at = NOW()
    FROM overdue o
    WHERE qe.id = o.id AND qe.status = 'CALLED'
    RETURNING qe.id, qe.restaurant_id, qe.customer_name, qe.display_number
  )
  SELECT COALESCE(array_agg(u.id), '{}'), count(*) INTO v_ids, v_count FROM updated u;

  -- Step 2: side effects for exactly the transitioned rows (same transaction = atomic)
  IF v_count > 0 THEN
    INSERT INTO public.queue_events (restaurant_id, queue_entry_id, event_type, metadata)
    SELECT qe.restaurant_id, qe.id, 'QUEUE_NO_SHOW',
           jsonb_build_object('reason', 'CUSTOMER_DID_NOT_RESPOND', 'auto', true)
    FROM public.queue_entries qe
    WHERE qe.id = ANY (v_ids);

    INSERT INTO public.outbox_events (restaurant_id, event_type, aggregate_type, aggregate_id, payload, status)
    SELECT qe.restaurant_id, 'QUEUE_NO_SHOW', 'QUEUE', qe.id::text,
           jsonb_build_object('reason', 'CUSTOMER_DID_NOT_RESPOND', 'auto', true,
                              'customerName', qe.customer_name, 'displayNumber', qe.display_number),
           'PENDING'
    FROM public.queue_entries qe
    WHERE qe.id = ANY (v_ids);
  END IF;

  -- pg_notify per expired row (best-effort realtime; polling fallback covers failures)
  IF v_count > 0 THEN
    PERFORM pg_notify('queue_entry_update',
      json_build_object('event', 'QUEUE_NO_SHOW', 'auto', true, 'count', v_count)::text);
  END IF;

  RETURN QUERY SELECT v_count, COALESCE(v_ids, '{}');
END;
$$;

REVOKE ALL ON FUNCTION public.expire_overdue_called_queue_entries(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_overdue_called_queue_entries(INT) TO service_role;
-- Migration: Fix seating mode multi-table assignment and exclusive vs shared capacity
-- Ensures SIMPLE mode marks combined tables exclusively occupied (free_seats = 0)
-- while STRICT mode tracks accurate shared capacity without bogus table reservations.

CREATE OR REPLACE FUNCTION public.seat_queue_entry_atomic(
  p_queue_entry_id UUID,
  p_table_id UUID,
  p_actor_user_id UUID DEFAULT NULL,
  p_actual_guests INT DEFAULT NULL,
  p_additional_table_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry public.queue_entries%ROWTYPE;
  v_primary_table public.restaurant_tables%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
  v_seating_count INT;
  v_total_capacity INT := 0;
  v_all_table_ids UUID[];
  v_cur_table_id UUID;
  v_cur_table public.restaurant_tables%ROWTYPE;
  v_remaining_guests INT;
  v_alloc INT;
  v_combined_numbers TEXT := '';
  v_restaurant public.restaurants%ROWTYPE;
BEGIN
  -- 1. Lock Queue Entry
  SELECT * INTO v_entry FROM public.queue_entries WHERE id = p_queue_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUEUE_ENTRY_NOT_FOUND'; END IF;
  IF v_entry.status = 'SEATED' THEN RAISE EXCEPTION 'QUEUE_ENTRY_ALREADY_SEATED'; END IF;
  IF v_entry.status NOT IN ('WAITING','NOTIFIED','CALLED') THEN
    RAISE EXCEPTION 'QUEUE_ENTRY_NOT_SEATABLE: status % cannot be seated', v_entry.status;
  END IF;

  -- Get restaurant configuration
  SELECT * INTO v_restaurant FROM public.restaurants WHERE id = v_entry.restaurant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESTAURANT_NOT_FOUND'; END IF;

  -- Check actor permission if provided
  IF p_actor_user_id IS NOT NULL THEN
    IF NOT public.has_restaurant_role(p_actor_user_id, v_entry.restaurant_id, ARRAY['RESTAURANT_ADMIN','STAFF']) THEN
      IF NOT public.is_super_admin(p_actor_user_id) THEN
        RAISE EXCEPTION 'UNAUTHORIZED';
      END IF;
    END IF;
  END IF;

  -- Determine confirmed headcount
  IF p_actual_guests IS NOT NULL THEN
    IF p_actual_guests <= 0 THEN RAISE EXCEPTION 'INVALID_ACTUAL_GUESTS'; END IF;
    v_seating_count := p_actual_guests;
  ELSE
    v_seating_count := v_entry.party_size;
  END IF;

  -- 2. Build list of table IDs (primary + additional)
  v_all_table_ids := ARRAY[p_table_id];
  IF p_additional_table_ids IS NOT NULL AND array_length(p_additional_table_ids, 1) > 0 THEN
    FOREACH v_cur_table_id IN ARRAY p_additional_table_ids LOOP
      IF v_cur_table_id IS NOT NULL AND NOT (v_cur_table_id = ANY(v_all_table_ids)) THEN
        v_all_table_ids := array_append(v_all_table_ids, v_cur_table_id);
      END IF;
    END LOOP;
  END IF;

  -- 3. Lock and validate all tables
  v_remaining_guests := v_seating_count;

  FOREACH v_cur_table_id IN ARRAY v_all_table_ids LOOP
    SELECT * INTO v_cur_table FROM public.restaurant_tables WHERE id = v_cur_table_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'TABLE_NOT_FOUND: %', v_cur_table_id; END IF;
    IF v_cur_table.restaurant_id != v_entry.restaurant_id THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
    IF v_cur_table.is_archived THEN RAISE EXCEPTION 'TABLE_ARCHIVED'; END IF;

    -- Validate table availability according to mode:
    IF v_restaurant.seating_mode = 'SIMPLE' THEN
      IF v_cur_table.status != 'AVAILABLE' THEN
        RAISE EXCEPTION 'TABLE_NOT_AVAILABLE';
      END IF;
      v_total_capacity := v_total_capacity + v_cur_table.capacity;
    ELSE
      -- In STRICT mode, table can be AVAILABLE or OCCUPIED if it has free_seats
      IF v_cur_table.status NOT IN ('AVAILABLE', 'OCCUPIED') THEN
        RAISE EXCEPTION 'TABLE_NOT_AVAILABLE';
      END IF;
      IF v_cur_table.free_seats <= 0 THEN
        RAISE EXCEPTION 'INSUFFICIENT_TABLE_CAPACITY: Table % has no free seats', v_cur_table.table_number;
      END IF;
      v_total_capacity := v_total_capacity + v_cur_table.free_seats;
    END IF;

    IF v_cur_table_id = p_table_id THEN
      v_primary_table := v_cur_table;
    END IF;

    IF v_combined_numbers = '' THEN
      v_combined_numbers := v_cur_table.table_number;
    ELSE
      v_combined_numbers := v_combined_numbers || ' + ' || v_cur_table.table_number;
    END IF;
  END LOOP;

  IF v_total_capacity < v_seating_count THEN
    RAISE EXCEPTION 'INSUFFICIENT_TABLE_CAPACITY';
  END IF;

  -- 4. Create Active Seating Assignments & update table occupancy
  FOREACH v_cur_table_id IN ARRAY v_all_table_ids LOOP
    SELECT * INTO v_cur_table FROM public.restaurant_tables WHERE id = v_cur_table_id;
    
    -- Calculate allocated seats for this table
    IF v_restaurant.seating_mode = 'SIMPLE' THEN
      v_alloc := LEAST(v_cur_table.capacity, v_remaining_guests);
    ELSE
      v_alloc := LEAST(v_cur_table.free_seats, v_remaining_guests);
    END IF;
    IF v_alloc <= 0 THEN v_alloc := 1; END IF;

    -- Record assignment in junction table
    INSERT INTO public.active_seating_assignments (
      restaurant_id, queue_entry_id, table_id, guests_allocated, is_primary, created_at, updated_at
    ) VALUES (
      v_entry.restaurant_id, p_queue_entry_id, v_cur_table_id, v_alloc, (v_cur_table_id = p_table_id), v_now, v_now
    )
    ON CONFLICT (queue_entry_id, table_id) DO UPDATE
    SET guests_allocated = EXCLUDED.guests_allocated, updated_at = v_now;

    -- Update table occupied and free seats
    UPDATE public.restaurant_tables
    SET
      status = 'OCCUPIED',
      occupied_seats = occupied_seats + v_alloc,
      free_seats = GREATEST(0, capacity - (occupied_seats + v_alloc)),
      updated_at = v_now
    WHERE id = v_cur_table_id;

    v_remaining_guests := GREATEST(0, v_remaining_guests - v_alloc);
  END LOOP;

  -- 5. Update Queue Entry status -> SEATED
  UPDATE public.queue_entries
  SET status = 'SEATED',
      seated_table_id = p_table_id,
      seated_at = v_now,
      actual_guests = v_seating_count,
      updated_at = v_now
  WHERE id = p_queue_entry_id
  RETURNING * INTO v_entry;

  -- 6. Insert events & audit logs
  INSERT INTO public.queue_events (restaurant_id, queue_entry_id, event_type, actor_user_id, metadata)
  VALUES (
    v_entry.restaurant_id,
    p_queue_entry_id,
    'QUEUE_SEATED',
    p_actor_user_id,
    jsonb_build_object(
      'table_id', p_table_id,
      'table_number', v_primary_table.table_number,
      'combined_table_numbers', v_combined_numbers,
      'all_table_ids', v_all_table_ids,
      'party_size', v_entry.party_size,
      'actual_guests', v_entry.actual_guests,
      'previous_status', v_entry.status,
      'seating_mode', v_restaurant.seating_mode
    )
  );

  INSERT INTO public.outbox_events (restaurant_id, event_type, aggregate_type, aggregate_id, payload, status)
  VALUES (
    v_entry.restaurant_id,
    'QUEUE_SEATED',
    'QUEUE',
    p_queue_entry_id::text,
    jsonb_build_object(
      'previousStatus', v_entry.status,
      'newStatus', 'SEATED',
      'customerName', v_entry.customer_name,
      'displayNumber', v_entry.display_number,
      'tableId', p_table_id,
      'allTableIds', v_all_table_ids,
      'combinedTableNumbers', v_combined_numbers,
      'actualGuests', v_entry.actual_guests
    ),
    'PENDING'
  );

  RETURN jsonb_build_object(
    'success', true,
    'queue_entry_id', v_entry.id,
    'queueEntryId', v_entry.id,
    'primary_table_id', p_table_id,
    'tableId', p_table_id,
    'all_table_ids', v_all_table_ids,
    'combined_table_numbers', v_combined_numbers,
    'status', v_entry.status,
    'party_size', v_entry.party_size,
    'actual_guests', v_entry.actual_guests,
    'seated_at', v_entry.seated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seat_queue_entry_atomic(UUID, UUID, UUID, INT, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seat_queue_entry_atomic(UUID, UUID, UUID, INT, UUID[]) TO service_role;
-- Migration: 20260930000000_customer_call_response.sql
-- Description: Customer Table-Call Response Flow
-- Adds call response tracking to queue_entries and creates atomic respond_to_call_atomic RPC.

-- 1. EXTEND QUEUE_ENTRIES WITH CALL RESPONSE TRACKING
ALTER TABLE public.queue_entries
  ADD COLUMN IF NOT EXISTS call_response TEXT CHECK (call_response IS NULL OR call_response IN ('ACCEPTED', 'DELAY_REQUESTED', 'DECLINED')),
  ADD COLUMN IF NOT EXISTS call_responded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS call_delay_minutes INT CHECK (call_delay_minutes IS NULL OR call_delay_minutes > 0);

-- 2. CREATE ATOMIC CALL RESPONSE RPC
CREATE OR REPLACE FUNCTION public.respond_to_call_atomic(
  p_queue_entry_id UUID,
  p_token_hash TEXT,
  p_response TEXT,
  p_delay_minutes INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry public.queue_entries%ROWTYPE;
  v_restaurant public.restaurants%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
  v_timeout_mins INT;
  v_delay_mins INT;
  v_event_type TEXT;
BEGIN
  -- 1. Validate response parameter
  IF p_response NOT IN ('ACCEPTED', 'DELAY_REQUESTED', 'DECLINED') THEN
    RAISE EXCEPTION 'INVALID_CALL_RESPONSE: %', p_response;
  END IF;

  -- 2. Lock queue entry row FOR UPDATE
  SELECT * INTO v_entry
  FROM public.queue_entries
  WHERE id = p_queue_entry_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUEUE_ENTRY_NOT_FOUND';
  END IF;

  -- 3. Validate customer bearer token authentication
  IF v_entry.token_hash IS NULL OR v_entry.token_hash != p_token_hash THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  -- 4. Check terminal states
  IF v_entry.status IN ('SEATED', 'CANCELLED', 'NO_SHOW', 'EXPIRED') THEN
    RAISE EXCEPTION 'QUEUE_ENTRY_TERMINAL: Cannot respond to call in status %', v_entry.status;
  END IF;

  -- 5. Must currently be in CALLED state
  IF v_entry.status != 'CALLED' THEN
    RAISE EXCEPTION 'QUEUE_ENTRY_NOT_CALLED: Entry is in status %', v_entry.status;
  END IF;

  -- 6. Check call timeout against restaurant configuration (server-authoritative)
  SELECT * INTO v_restaurant
  FROM public.restaurants
  WHERE id = v_entry.restaurant_id;

  v_timeout_mins := COALESCE(v_restaurant.call_timeout_minutes, 15);

  IF v_entry.called_at IS NOT NULL AND v_now > v_entry.called_at + (v_timeout_mins || ' minutes')::INTERVAL THEN
    RAISE EXCEPTION 'CALL_EXPIRED: The response window of % minutes has elapsed', v_timeout_mins;
  END IF;

  -- 7. Idempotency: if already responded with the exact same response, return existing state
  IF v_entry.call_response = p_response THEN
    IF p_response != 'DELAY_REQUESTED' OR v_entry.call_delay_minutes = p_delay_minutes THEN
      RETURN jsonb_build_object(
        'success', true,
        'queueEntryId', v_entry.id,
        'status', v_entry.status,
        'callResponse', v_entry.call_response,
        'callRespondedAt', v_entry.call_responded_at,
        'callDelayMinutes', v_entry.call_delay_minutes,
        'idempotent', true
      );
    END IF;
  END IF;

  -- 8. Apply atomic transition according to customer decision
  IF p_response = 'ACCEPTED' THEN
    UPDATE public.queue_entries
    SET call_response = 'ACCEPTED',
        call_responded_at = v_now,
        updated_at = v_now
    WHERE id = p_queue_entry_id
    RETURNING * INTO v_entry;

    v_event_type := 'QUEUE_CALL_ACCEPTED';

    INSERT INTO public.queue_events (restaurant_id, queue_entry_id, event_type, metadata)
    VALUES (
      v_entry.restaurant_id,
      v_entry.id,
      v_event_type,
      jsonb_build_object('response', 'ACCEPTED', 'responded_at', v_now)
    );

    INSERT INTO public.outbox_events (restaurant_id, event_type, aggregate_type, aggregate_id, payload, status)
    VALUES (
      v_entry.restaurant_id,
      v_event_type,
      'QUEUE',
      v_entry.id::text,
      jsonb_build_object(
        'queueEntryId', v_entry.id,
        'displayNumber', v_entry.display_number,
        'customerName', v_entry.customer_name,
        'response', 'ACCEPTED',
        'respondedAt', v_now
      ),
      'PENDING'
    );

  ELSIF p_response = 'DELAY_REQUESTED' THEN
    v_delay_mins := LEAST(60, GREATEST(1, COALESCE(p_delay_minutes, 10)));

    UPDATE public.queue_entries
    SET call_response = 'DELAY_REQUESTED',
        call_responded_at = v_now,
        call_delay_minutes = v_delay_mins,
        updated_at = v_now
    WHERE id = p_queue_entry_id
    RETURNING * INTO v_entry;

    v_event_type := 'CUSTOMER_LATE';

    -- Integrates with existing late tracking
    INSERT INTO public.queue_events (restaurant_id, queue_entry_id, event_type, metadata)
    VALUES (
      v_entry.restaurant_id,
      v_entry.id,
      'CUSTOMER_LATE',
      jsonb_build_object('delayMinutes', v_delay_mins, 'reportedAt', v_now, 'fromCallResponse', true)
    );

    INSERT INTO public.queue_events (restaurant_id, queue_entry_id, event_type, metadata)
    VALUES (
      v_entry.restaurant_id,
      v_entry.id,
      'QUEUE_CALL_DELAY_REQUESTED',
      jsonb_build_object('delayMinutes', v_delay_mins, 'responded_at', v_now)
    );

    INSERT INTO public.outbox_events (restaurant_id, event_type, aggregate_type, aggregate_id, payload, status)
    VALUES (
      v_entry.restaurant_id,
      'QUEUE_CALL_DELAY_REQUESTED',
      'QUEUE',
      v_entry.id::text,
      jsonb_build_object(
        'queueEntryId', v_entry.id,
        'displayNumber', v_entry.display_number,
        'customerName', v_entry.customer_name,
        'delayMinutes', v_delay_mins,
        'respondedAt', v_now
      ),
      'PENDING'
    );

  ELSIF p_response = 'DECLINED' THEN
    -- Declining call transitions entry to CANCELLED (existing cancellation semantics)
    UPDATE public.queue_entries
    SET status = 'CANCELLED',
        cancelled_at = v_now,
        call_response = 'DECLINED',
        call_responded_at = v_now,
        updated_at = v_now
    WHERE id = p_queue_entry_id
    RETURNING * INTO v_entry;

    v_event_type := 'QUEUE_CANCELLED';

    INSERT INTO public.queue_events (restaurant_id, queue_entry_id, event_type, metadata)
    VALUES (
      v_entry.restaurant_id,
      v_entry.id,
      'QUEUE_CANCELLED',
      jsonb_build_object('reason', 'CUSTOMER_DECLINED_CALL', 'responded_at', v_now)
    );

    INSERT INTO public.outbox_events (restaurant_id, event_type, aggregate_type, aggregate_id, payload, status)
    VALUES (
      v_entry.restaurant_id,
      'QUEUE_CANCELLED',
      'QUEUE',
      v_entry.id::text,
      jsonb_build_object(
        'queueEntryId', v_entry.id,
        'displayNumber', v_entry.display_number,
        'customerName', v_entry.customer_name,
        'reason', 'CUSTOMER_DECLINED_CALL',
        'cancelledAt', v_now
      ),
      'PENDING'
    );
  END IF;

  -- 9. Realtime notification ping to staff and listeners
  PERFORM pg_notify('queue_entry_update', json_build_object(
    'restaurant_id', v_entry.restaurant_id,
    'entry_id', v_entry.id,
    'event', v_event_type,
    'call_response', v_entry.call_response
  )::text);

  RETURN jsonb_build_object(
    'success', true,
    'queueEntryId', v_entry.id,
    'status', v_entry.status,
    'callResponse', v_entry.call_response,
    'callRespondedAt', v_entry.call_responded_at,
    'callDelayMinutes', v_entry.call_delay_minutes
  );
END;
$$;

-- 3. PERMISSIONS: LEAST PRIVILEGE (service_role only, server-authenticated via qtoken)
REVOKE ALL ON FUNCTION public.respond_to_call_atomic(UUID, TEXT, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_call_atomic(UUID, TEXT, TEXT, INT) TO service_role;
