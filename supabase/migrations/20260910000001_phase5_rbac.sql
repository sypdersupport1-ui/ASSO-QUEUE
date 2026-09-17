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
