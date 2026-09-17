-- QueueFlow Development Seed Data Script (Phase 2)
-- Seeds test restaurants, auth users, user profiles, memberships, zones, tables, categories, menu items.

-- 1. SEED RESTAURANTS
INSERT INTO public.restaurants (id, name, slug, description, phone, email, address, city, state, country, timezone, currency, status)
VALUES 
  ('11111111-1111-4111-a111-111111111111', 'Le Petit Bistro', 'le-petit-bistro', 'Charming French Bistro', '+15551000001', 'info@bistro.com', '123 Gourmet Way', 'New York', 'NY', 'USA', 'America/New_York', 'USD', 'ACTIVE'),
  ('22222222-2222-4222-a222-222222222222', 'Tokyo Ramen Lab', 'tokyo-ramen-lab', 'Authentic Artisanal Ramen', '+15551000002', 'contact@ramenlab.com', '456 Noodle Blvd', 'San Francisco', 'CA', 'USA', 'America/Los_Angeles', 'USD', 'ACTIVE')
ON CONFLICT (slug) DO NOTHING;

-- 2. SEED AUTH USERS IN auth.users
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('a0000000-0000-4000-a000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'superadmin@queueflow.io', '$2a$10$abcdefghijklmnopqrstuu', NOW(), '{"provider":"email","providers":["email"]}', '{"role":"SUPER_ADMIN"}', NOW(), NOW()),
  ('a0000000-0000-4000-a000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'alice@bistro.com', '$2a$10$abcdefghijklmnopqrstuu', NOW(), '{"provider":"email","providers":["email"]}', '{"role":"RESTAURANT_ADMIN","restaurant_id":"11111111-1111-4111-a111-111111111111"}', NOW(), NOW()),
  ('a0000000-0000-4000-a000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bob@ramenlab.com', '$2a$10$abcdefghijklmnopqrstuu', NOW(), '{"provider":"email","providers":["email"]}', '{"role":"RESTAURANT_ADMIN","restaurant_id":"22222222-2222-4222-a222-222222222222"}', NOW(), NOW()),
  ('a0000000-0000-4000-a000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'charlie@bistro.com', '$2a$10$abcdefghijklmnopqrstuu', NOW(), '{"provider":"email","providers":["email"]}', '{"role":"STAFF","restaurant_id":"11111111-1111-4111-a111-111111111111"}', NOW(), NOW()),
  ('a0000000-0000-4000-a000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'diana@ramenlab.com', '$2a$10$abcdefghijklmnopqrstuu', NOW(), '{"provider":"email","providers":["email"]}', '{"role":"STAFF","restaurant_id":"22222222-2222-4222-a222-222222222222"}', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- 3. SEED USER PROFILES
INSERT INTO public.user_profiles (id, display_name, email, phone)
VALUES
  ('a0000000-0000-4000-a000-000000000001', 'Platform Super Admin', 'superadmin@queueflow.io', '+15550009999'),
  ('a0000000-0000-4000-a000-000000000002', 'Alice (Admin Bistro)', 'alice@bistro.com', '+15551001111'),
  ('a0000000-0000-4000-a000-000000000003', 'Bob (Admin Ramen)', 'bob@ramenlab.com', '+15551002222'),
  ('a0000000-0000-4000-a000-000000000004', 'Charlie (Staff Bistro)', 'charlie@bistro.com', '+15551003333'),
  ('a0000000-0000-4000-a000-000000000005', 'Diana (Staff Ramen)', 'diana@ramenlab.com', '+15551004444')
ON CONFLICT (id) DO NOTHING;

-- 4. SEED RESTAURANT MEMBERSHIPS
INSERT INTO public.restaurant_memberships (user_id, restaurant_id, role, status)
VALUES
  ('a0000000-0000-4000-a000-000000000001', NULL, 'SUPER_ADMIN', 'ACTIVE'),
  ('a0000000-0000-4000-a000-000000000002', '11111111-1111-4111-a111-111111111111', 'RESTAURANT_ADMIN', 'ACTIVE'),
  ('a0000000-0000-4000-a000-000000000003', '22222222-2222-4222-a222-222222222222', 'RESTAURANT_ADMIN', 'ACTIVE'),
  ('a0000000-0000-4000-a000-000000000004', '11111111-1111-4111-a111-111111111111', 'STAFF', 'ACTIVE'),
  ('a0000000-0000-4000-a000-000000000005', '22222222-2222-4222-a222-222222222222', 'STAFF', 'ACTIVE')
ON CONFLICT DO NOTHING;

-- 5. SEED ZONES
INSERT INTO public.restaurant_zones (id, restaurant_id, name, description, sort_order)
VALUES
  ('33333333-3333-4333-a333-333333333331', '11111111-1111-4111-a111-111111111111', 'Main Hall', 'Indoor dining hall', 1),
  ('33333333-3333-4333-a333-333333333332', '11111111-1111-4111-a111-111111111111', 'Patio Outdoor', 'Open air patio', 2),
  ('33333333-3333-4333-a333-333333333333', '22222222-2222-4222-a222-222222222222', 'Noodle Bar', 'Counter seating', 1)
ON CONFLICT DO NOTHING;

-- 6. SEED TABLES
INSERT INTO public.restaurant_tables (restaurant_id, zone_id, table_number, capacity, status)
VALUES
  ('11111111-1111-4111-a111-111111111111', '33333333-3333-4333-a333-333333333331', 'T-01', 2, 'AVAILABLE'),
  ('11111111-1111-4111-a111-111111111111', '33333333-3333-4333-a333-333333333331', 'T-02', 4, 'AVAILABLE'),
  ('22222222-2222-4222-a222-222222222222', '33333333-3333-4333-a333-333333333333', 'BAR-01', 1, 'AVAILABLE'),
  ('22222222-2222-4222-a222-222222222222', '33333333-3333-4333-a333-333333333333', 'BAR-02', 1, 'AVAILABLE')
ON CONFLICT DO NOTHING;

-- 7. SEED MENU CATEGORIES
INSERT INTO public.menu_categories (id, restaurant_id, name, description, sort_order, active)
VALUES
  ('44444444-4444-4444-a444-444444444441', '11111111-1111-4111-a111-111111111111', 'Starters', 'French appetizers', 1, TRUE),
  ('44444444-4444-4444-a444-444444444442', '11111111-1111-4111-a111-111111111111', 'Entrees', 'Main dishes', 2, TRUE),
  ('44444444-4444-4444-a444-444444444443', '22222222-2222-4222-a222-222222222222', 'Ramen', 'House ramen bowls', 1, TRUE)
ON CONFLICT DO NOTHING;

-- 8. SEED MENU ITEMS
INSERT INTO public.menu_items (restaurant_id, category_id, name, description, price, currency, preparation_time_minutes, active, available)
VALUES
  ('11111111-1111-4111-a111-111111111111', '44444444-4444-4444-a444-444444444441', 'French Onion Soup', 'Classic onion soup with gruyere', 14.50, 'USD', 12, TRUE, TRUE),
  ('11111111-1111-4111-a111-111111111111', '44444444-4444-4444-a444-444444444442', 'Steak Frites', 'Prime ribeye with crispy fries', 34.00, 'USD', 20, TRUE, TRUE),
  ('22222222-2222-4222-a222-222222222222', '44444444-4444-4444-a444-444444444443', 'Tonkotsu Special', 'Rich pork bone broth noodle soup', 18.50, 'USD', 10, TRUE, TRUE)
ON CONFLICT DO NOTHING;
