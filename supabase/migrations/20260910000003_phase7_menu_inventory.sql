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
