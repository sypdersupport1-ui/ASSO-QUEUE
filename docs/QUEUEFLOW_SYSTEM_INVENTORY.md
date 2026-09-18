# QUEUEFLOW — COMPLETE EXISTING SYSTEM & FEATURE INVENTORY
**Forensic Codebase & Architecture Audit**  
*Generated: September 2026*

---

## EXECUTIVE SUMMARY

This document provides an exhaustive, read-only forensic audit of the **QueueFlow** codebase. QueueFlow is a multi-tenant restaurant queue, seating, ordering, and operations management platform built with **Next.js 14 (App Router)** and **Supabase (PostgreSQL, Row-Level Security, Realtime, Auth)**.

The codebase features:
- A fully functional, production-hardened **Dine-In** queue and seating system with multi-table combination and seat-sharing capabilities.
- A recently completed, production-hardened **Takeaway** subsystem (Phases 1–4) with isolated queue positioning, order-first checkout, "Pay at Counter" operational semantics, and zero table seating leakage.
- A **Menu & Catalog Subsystem** supporting categories, items, server-authoritative pricing, stock toggling, and soft archival.
- An **Order & Kitchen Kanban Subsystem** providing real-time ticket progression from placement to fulfillment.
- A **Transactional Outbox Pattern** guaranteeing resilient event delivery and retries.
- Comprehensive **RBAC** across Super Admin, Restaurant Admin, and Staff roles.

---

## 1. HIGH-LEVEL APPLICATION MAP

```
QUEUEFLOW ARCHITECTURE
├── Frontend Interfaces
│   ├── Customer Web Experience (/q/[slug]/*)
│   │   ├── Landing & Service Selection (/q/[slug]/page.tsx)
│   │   ├── Dine-In Join Queue & Ticket Tracker (/q/[slug]/status/page.tsx)
│   │   ├── Takeaway Menu Browser & Cart (/q/[slug]/menu/page.tsx)
│   │   ├── Takeaway Order Summary & Checkout (/q/[slug]/order/page.tsx)
│   │   └── Customer Payment / Counter Guidance (/q/[slug]/payment/page.tsx)
│   ├── Staff / Admin Dashboard (/dashboard/*)
│   │   ├── Live Queue & Service Controller (/dashboard/queue/page.tsx)
│   │   ├── Floor Plan, Seating & Table Grid (/dashboard/tables/page.tsx)
│   │   ├── Live Kitchen / Order Manager (/dashboard/kitchen/page.tsx)
│   │   ├── Menu Management (/dashboard/menu/page.tsx)
│   │   ├── Staff & RBAC Management (/dashboard/staff/page.tsx)
│   │   ├── Restaurant Operational Settings (/dashboard/settings/page.tsx)
│   │   ├── Payments & Reconciliation Ledger (/dashboard/payments/page.tsx)
│   │   └── Analytics & Turnover Reports (/dashboard/analytics/page.tsx)
│   ├── Super Admin Platform (/platform/*)
│   │   ├── Multi-tenant Venue Oversight (/platform/page.tsx)
│   │   ├── Restaurant Onboarding & Status (/platform/restaurants/page.tsx)
│   │   ├── Platform Footfall Analytics (/platform/footfall/page.tsx)
│   │   ├── Audit Log Viewer (/platform/audit-logs/page.tsx)
│   │   └── System Settings (/platform/settings/page.tsx)
│   └── Public / Authentication
│       ├── Marketing / Landing Page (/src/app/page.tsx)
│       ├── Staff / Admin Sign In (/src/app/login/page.tsx)
│       └── Auth Callback / Session (/src/app/auth/callback/route.ts)
│
└── Backend Subsystems
    ├── Server Actions
    │   ├── Customer Actions (src/app/q/actions.ts)
    │   └── Staff / Dashboard Actions (src/app/dashboard/actions.ts)
    ├── REST API Endpoints (src/app/api/*)
    │   ├── Customer Endpoints (/api/customer/orders, /api/customer/notifications)
    │   ├── Staff Endpoints (/api/staff/notifications)
    │   ├── Queue Public Endpoints (/api/q/join, /api/q/status, /api/q/cancel, /api/q/chat, /api/q/late, /api/q/exit)
    │   ├── Payment Endpoints (/api/payments/intent, /api/payments/verify, /api/payments/manual, /api/payments/refund, /api/payments/webhook)
    │   └── Cron / Maintenance (/api/cron/queue-maintenance, /api/cron/notifications)
    ├── Domain Services (src/lib/services/*)
    │   ├── QueueService, OrderService, MenuService, SeatingService
    │   ├── NotificationService, OutboxService, PaymentService, AnalyticsService
    │   ├── RestaurantAdminService, SuperAdminService, InventoryService, SecurityService
    │   └── QueueHealthService, QueueScheduleService, AuditService, RedisService
    ├── Database & RLS (supabase/migrations/*)
    │   └── 26 PostgreSQL relational tables, 28 RPC functions, Row Level Security policies
    ├── Realtime (src/lib/realtime/*)
    │   └── Supabase Broadcast channels + Postgres Changes subscriptions
    ├── Scheduled Background Processing
    │   └── Vercel Cron endpoints with Bearer authentication & Outbox leasing worker
    └── External Payment Providers (src/lib/payments/providers/*)
        ├── ManualProvider (Cash / POS card / counter recording)
        └── RazorpayProvider (Mock / Local HMAC signature stub only — no live gateway SDK)
```

---

## 2. DATABASE SCHEMA INVENTORY

Inspected across all migration scripts (`supabase/migrations/00000000000000_init.sql` through `20261001000001_phase4_takeaway_hardening.sql`) and verified against `src/types/database.types.ts`.

| Table | Purpose | Important Columns | Relationships | RLS | RPC/Trigger Dependencies | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `restaurants` | Core multi-tenant venue entity | `id`, `name`, `slug`, `status`, `operating_mode`, `seating_mode`, `takeaway_enabled`, `queue_operating_state`, `capacity`, `notification_settings`, `no_show_timeout_minutes` | Parent to all tenant data | ENABLED | `update_timestamp_trigger`, `handle_new_restaurant` | ACTIVE |
| `user_profiles` | User account profiles | `id`, `email`, `display_name`, `avatar_url`, `created_at` | References `auth.users(id)` | ENABLED | `handle_new_user` | ACTIVE |
| `restaurant_memberships` | RBAC membership table | `id`, `restaurant_id`, `user_id`, `role` (`SUPER_ADMIN`, `RESTAURANT_ADMIN`, `STAFF`), `status` | FK to `restaurants`, `auth.users` | ENABLED | Checked by security helper functions (`has_restaurant_role`, `has_permission`) | ACTIVE |
| `restaurant_zones` | Physical floor zones | `id`, `restaurant_id`, `name`, `description`, `is_active` | FK to `restaurants` | ENABLED | Cascaded by restaurant deletion | ACTIVE |
| `restaurant_tables` | Physical tables & capacities | `id`, `restaurant_id`, `zone_id`, `table_number`, `capacity`, `min_capacity`, `shape`, `status`, `occupied_seats`, `free_seats`, `can_combine`, `is_active` | FK to `restaurants`, `restaurant_zones` | ENABLED | Checked by `assign_seating_atomic`, `release_seating_atomic` | ACTIVE |
| `active_seating_assignments` | Real-time seat allocation | `id`, `restaurant_id`, `table_id`, `queue_entry_id`, `allocated_seats`, `status`, `seated_at`, `released_at` | FK to `restaurants`, `restaurant_tables`, `queue_entries` | ENABLED | Core tracking table for `assign_seating_atomic` | ACTIVE |
| `queue_entries` | Queue tickets & lifecycle | `id`, `restaurant_id`, `ticket_number`, `queue_type` (`DINE_IN`, `TAKEAWAY`), `customer_name`, `customer_phone`, `party_size`, `status`, `verification_token`, `verification_token_hash`, `device_fingerprint`, `joined_at`, `called_at`, `seated_at`, `completed_at`, `cancelled_at` | FK to `restaurants` | ENABLED | `complete_takeaway_atomic`, `assign_seating_atomic`, check constraints | ACTIVE |
| `queue_events` | Queue state transition audit | `id`, `queue_entry_id`, `restaurant_id`, `event_type`, `from_status`, `to_status`, `payload`, `created_at` | FK to `queue_entries`, `restaurants` | ENABLED | Written by `QueueService` transitions | ACTIVE |
| `menu_categories` | Menu classification | `id`, `restaurant_id`, `name`, `description`, `sort_order`, `is_active` | FK to `restaurants` | ENABLED | `MenuService` | ACTIVE |
| `menu_items` | Catalog of dishes/products | `id`, `restaurant_id`, `category_id`, `name`, `description`, `price_cents`, `image_url`, `preparation_time_minutes`, `is_active`, `is_available`, `is_archived`, `display_order` | FK to `restaurants`, `menu_categories` | ENABLED | Referenced in `order_items`, `menu_item_ingredients` | ACTIVE |
| `orders` | Transactional customer orders | `id`, `restaurant_id`, `queue_entry_id`, `order_number`, `order_token_hash`, `status` (`DRAFT`, `PENDING`, `CONFIRMED`, `IN_PROGRESS`, `READY`, `SERVED`, `CANCELLED`), `payment_status` (`PENDING`, `AUTHORIZED`, `PAID`, `REFUNDED`, `FAILED`), `subtotal_cents`, `tax_cents`, `total_cents` | FK to `restaurants`, `queue_entries` | ENABLED | Unique index: `idx_orders_unique_active_queue_entry` | ACTIVE |
| `order_items` | Order line-item snapshots | `id`, `order_id`, `menu_item_id`, `item_name`, `quantity`, `unit_price_cents`, `subtotal_cents`, `special_instructions` | FK to `orders`, `menu_items` | ENABLED | Snapshot guarantees historical price integrity | ACTIVE |
| `order_events` | Order lifecycle audit | `id`, `order_id`, `event_type`, `from_status`, `to_status`, `payload`, `created_at` | FK to `orders` | ENABLED | Written by `OrderService` | ACTIVE |
| `payments` | Financial transactions | `id`, `restaurant_id`, `order_id`, `amount_cents`, `currency`, `provider` (`MANUAL`, `RAZORPAY`), `provider_payment_id`, `status`, `idempotency_key`, `metadata` | FK to `restaurants`, `orders` | ENABLED | `PaymentService` | ACTIVE |
| `payment_events` | Payment status audit log | `id`, `payment_id`, `event_type`, `from_status`, `to_status`, `payload`, `created_at` | FK to `payments` | ENABLED | Written by `PaymentService` | ACTIVE |
| `notifications` | In-app/Push dispatch queue | `id`, `restaurant_id`, `queue_entry_id`, `recipient_type`, `type`, `status`, `channel`, `payload`, `sent_at`, `expires_at` | FK to `restaurants`, `queue_entries` | ENABLED | Queried by notification polling API | ACTIVE |
| `outbox_events` | Transactional outbox pattern | `id`, `aggregate_type`, `aggregate_id`, `event_type`, `payload`, `status` (`PENDING`, `PROCESSING`, `PROCESSED`, `FAILED`), `retry_count`, `next_retry_at`, `leased_until`, `leased_by` | Unconstrained aggregate references | ENABLED | `lease_outbox_events`, `complete_outbox_event`, `fail_outbox_event` RPCs | ACTIVE |
| `audit_logs` | Platform audit logs | `id`, `restaurant_id`, `user_id`, `action`, `resource_type`, `resource_id`, `payload`, `ip_address`, `user_agent`, `created_at` | FK to `restaurants`, `auth.users` | ENABLED | Written by `AuditService` | ACTIVE |
| `permissions` | Granular permission registry | `id`, `key`, `name`, `description`, `module` | Canonical permission dictionary | ENABLED | Checked by `has_permission` RPC | ACTIVE |
| `role_permissions` | Default role-permission maps | `id`, `role`, `permission_key` | References `permissions(key)` | ENABLED | Seeded system-wide mappings | ACTIVE |
| `staff_permission_overrides` | Member-specific overrides | `id`, `membership_id`, `permission_key`, `is_granted` | FK to `restaurant_memberships`, `permissions` | ENABLED | Read by `get_user_permissions` RPC | ACTIVE |
| `inventory_items` | Stock/ingredient registry | `id`, `restaurant_id`, `name`, `sku`, `unit`, `current_stock`, `reorder_threshold`, `cost_per_unit_cents`, `is_active` | FK to `restaurants` | ENABLED | `InventoryService` | ACTIVE |
| `inventory_movements` | Stock adjustment ledgers | `id`, `inventory_item_id`, `movement_type`, `quantity`, `reference_type`, `reference_id`, `notes` | FK to `inventory_items` | ENABLED | `InventoryService` | ACTIVE |
| `menu_item_ingredients` | Recipe linkage | `id`, `menu_item_id`, `inventory_item_id`, `quantity_required` | FK to `menu_items`, `inventory_items` | ENABLED | `InventoryService` | ACTIVE |
| `restaurant_queue_hours` | Operating schedules & shifts | `id`, `restaurant_id`, `day_of_week` (0-6), `open_time`, `close_time`, `is_closed` | FK to `restaurants` | ENABLED | Evaluated by `QueueScheduleService` | ACTIVE |
| `qr_scans` | QR telemetry & analytics | `id`, `restaurant_id`, `device_fingerprint`, `scanned_at`, `user_agent`, `ip_hash` | FK to `restaurants` | ENABLED | Telemetry data collector | ACTIVE |

---

## 3. MENU SYSTEM — DETAILED AUDIT

| Question | Status | Exact File(s) | Service / Action / RPC | Summary Explanation |
| :--- | :---: | :--- | :--- | :--- |
| **A. Can Admin create a menu item?** | **IMPLEMENTED** | `src/app/dashboard/actions.ts`<br>`src/lib/services/menu-service.ts`<br>`src/app/dashboard/menu/page.tsx` | `createMenuItemFormAction`<br>`MenuService.createMenuItem` | Form in dashboard validates inputs via Zod; persists item with isolated `restaurant_id`. |
| **B. Can Admin edit a menu item?** | **PARTIAL** | `src/lib/services/menu-service.ts` | `MenuService.updateMenuItem` | Service layer fully supports updating fields, but `actions.ts` lacks an update action and the UI lacks an Edit Modal. |
| **C. Can Admin delete/archive a menu item?** | **IMPLEMENTED** | `src/app/dashboard/actions.ts`<br>`src/lib/services/menu-service.ts`<br>`src/app/dashboard/menu/page.tsx` | `archiveMenuItemAction`<br>`MenuService.archiveMenuItem` | Sets `is_archived = true`, removing item from active view while preserving historical orders. |
| **D. Can Admin enable/disable an item?** | **PARTIAL** | `src/lib/services/menu-service.ts` | `MenuService.updateMenuItem` | Service layer accepts `active` flag; UI displays active badge, but no direct toggle action exists (only available/archived). |
| **E. Can Admin mark out of stock?** | **IMPLEMENTED** | `src/app/dashboard/actions.ts`<br>`src/lib/services/menu-service.ts`<br>`src/app/dashboard/menu/page.tsx` | `updateMenuItemAvailabilityAction`<br>`MenuService.setMenuItemAvailability` | Interactive toggle immediately updates `is_available` in database; changes reflect on client menu. |
| **F. Can Admin set/change price?** | **PARTIAL** | `src/app/dashboard/actions.ts`<br>`src/lib/services/menu-service.ts` | `createMenuItemFormAction`<br>`MenuService.updateMenuItem` | Initial price setting is complete. Changing existing price has no UI or server action trigger. |
| **G. Can Admin add/edit categories?** | **PARTIAL** | `src/app/dashboard/actions.ts`<br>`src/lib/services/menu-service.ts`<br>`src/app/dashboard/menu/page.tsx` | `createCategoryFormAction`<br>`MenuService.createCategory`<br>`updateCategoryStatusAction` | Creation and active toggle are implemented. Renaming or editing existing categories lacks UI form. |
| **H. Can Admin reorder categories?** | **PARTIAL** | `src/lib/services/menu-service.ts`<br>`src/app/dashboard/menu/page.tsx` | `sort_order` column in `menu_categories` | Numerical sort order can be set on creation. Drag-and-drop or batch reorder UI is missing. |
| **I. Can Admin reorder items?** | **PARTIAL** | `src/lib/services/menu-service.ts`<br>`00000000000000_init.sql` | `display_order` column in `menu_items` | Database order is by `display_order ASC`, but no UI controls exist to adjust order. |
| **J. Can Admin upload images?** | **PARTIAL** | `src/lib/services/menu-service.ts` | `image_url` column in `menu_items` | Database and model support image URL string; Supabase Storage file uploader is missing. |
| **K. Does customer QR menu reflect changes?** | **IMPLEMENTED** | `src/app/q/[slug]/menu/page.tsx`<br>`CustomerMenuBrowser.tsx` | Direct DB queries filtered by active/available | Server-rendered and cached with instant revalidation on update actions. |
| **L. Is menu data tenant-isolated?** | **IMPLEMENTED** | `supabase/migrations/00000000000000_init.sql`<br>`src/lib/services/menu-service.ts` | RLS policies + `ctx.restaurantId` | Strict isolation enforced at both database RLS and service context layers. |
| **M. Is pricing server-authoritative?** | **IMPLEMENTED** | `src/lib/services/order-service.ts` | `OrderService.createCustomerOrder` | Client sends only `menuItemId` and `quantity`. Prices are fetched directly from database. |
| **N. Are stale carts handled?** | **IMPLEMENTED** | `src/lib/services/order-service.ts` | `OrderService.createCustomerOrder` | Validates every item against `is_active`, `is_available`, and `is_archived`. Rejects checkout if stale. |
| **O. What menu functionality is missing?** | — | — | — | 1. Dashboard UI Edit Modals for Items & Categories.<br>2. Supabase Storage bucket integration for image uploads.<br>3. Drag-and-drop reordering for items and categories.<br>4. Menu modifiers and item customization options. |

---

## 4. ORDER SYSTEM

- **Existing Order States**: `DRAFT`, `PENDING`, `CONFIRMED`, `IN_PROGRESS`, `READY`, `SERVED`, `CANCELLED`
- **Existing Payment States**: `PENDING`, `AUTHORIZED`, `PAID`, `REFUNDED`, `FAILED`
- **Customer Order Creation**: Fully implemented via `createTakeawayOrderAndQueueAction` in `src/app/q/actions.ts`.
- **Staff Order Creation**: Fully implemented via `createStaffTakeawayOrderAction` in `src/app/dashboard/actions.ts` using `StaffTakeawayOrderModal.tsx`.
- **Order Modification**: Staff can advance order lifecycle status and record payments. Customer modification post-placement is prevented.
- **Linkage Integrity**:
  - `orders.queue_entry_id` is non-nullable. Orders cannot exist without queue entries.
  - Dine-In queue entries can exist without orders.
  - Migration `20261001000001_phase4_takeaway_hardening.sql` enforces `idx_orders_unique_active_queue_entry`, ensuring strictly **one active order per queue ticket**.

---

## 5. TAKEAWAY SYSTEM (PHASES 1–4 COMPLETE AUDIT)

- **Queue Isolation**: `queue_entries.queue_type = 'TAKEAWAY'` is strictly immutable after creation. Takeaway queue positions calculate solely against other Takeaway tickets.
- **Seating Block**: `assign_seating_atomic` raises `'CANNOT_SEAT_TAKEAWAY_TICKET'` if invoked on a Takeaway entry.
- **Customer Flow**: Order-first QR journey: `/q/[slug]` -> Service Selection -> `/q/[slug]/menu` -> `/q/[slug]/order` -> `/q/[slug]/status`.
- **Operational Model**: "PAY AT COUNTER". Customers pay staff directly before or upon pickup.
- **Completion Atomicity**: PostgreSQL RPC `complete_takeaway_atomic` atomically transitions queue ticket to `COMPLETED` and order to `SERVED`.
- **Calling & Buzzer**: Staff triggers call alerts; customer ticket UI plays Web Audio API chime and activates device vibration.

---

## 6. DINE-IN SYSTEM

- **Queue Lifecycle**: Party size selection (1–20+), dietary notes, state machine transitions (`WAITING` -> `CALLED` -> `SEATED` -> `COMPLETED`).
- **Seating Modes**:
  - `SIMPLE`: Staff selects any table without strict capacity gating.
  - `STRICT`: System enforces `min_capacity <= party_size <= capacity`.
- **Table Allocation Engine**: `assign_seating_atomic` RPC allocates seats, manages multi-table joins (`table_ids uuid[]`), tracks shared seating, and recalculates `occupied_seats` and `free_seats`.
- **Floor & Recommendation Engine**:
  - Visual floor layout in `/dashboard/tables`.
  - `SeatingService.getRecommendedTables` suggests optimal table allocations based on active queue party sizes.

---

## 7. RESTAURANT SETTINGS AUDIT

| Setting | Status | File & Method |
| :--- | :---: | :--- |
| Restaurant Profile (Name, Phone, Address) | **IMPLEMENTED** | `dashboard/settings/page.tsx`, `RestaurantAdminService.updateRestaurantProfile` |
| Restaurant Logo / Branding | **PARTIAL** | DB `logo_url` column exists; UI text field present, no file uploader |
| Operating & Queue Hours | **IMPLEMENTED** | `restaurant_queue_hours` table, `QueueScheduleService.ts` |
| Timezone Configuration | **IMPLEMENTED** | `restaurants.timezone` column, evaluated in `QueueScheduleService` |
| Seating Mode (SIMPLE vs STRICT) | **IMPLEMENTED** | `dashboard/settings/page.tsx`, `updateSeatingModeAction` |
| Takeaway Enablement Switch | **IMPLEMENTED** | `dashboard/settings/page.tsx`, `updateTakeawaySettingsAction` |
| Call & No-Show Timeouts | **IMPLEMENTED** | `restaurants.no_show_timeout_minutes`, configurable in settings |
| SMS / WhatsApp Notification Toggles | **PARTIAL** | JSONB column `notification_settings`; UI toggles present, delivery stubs only |

---

## 8. STAFF & RBAC PERMISSIONS

- **Defined Roles**: `SUPER_ADMIN`, `RESTAURANT_ADMIN`, `STAFF`
- **Granular Permissions**: Defined in `permissions` and `role_permissions` tables (e.g., `queue:call`, `queue:seat`, `menu:manage`, `orders:create`, `settings:manage`).
- **Overrides**: `staff_permission_overrides` table supports per-user grant/revoke overrides.
- **Enforcement Levels**:
  1. UI rendering based on session hooks.
  2. Server Actions via `requireRestaurantRole`.
  3. Domain services via `SecurityService.requirePermission`.
  4. PostgreSQL RLS via `restaurant_memberships`.
  5. PostgreSQL RPCs via `SECURITY DEFINER` helper functions.

---

## 9. CUSTOMER JOURNEY & RESILIENCE

- **Dine-In Journey**: Scan QR -> Service Select -> Join Queue -> Ticket Tracker (`/q/[slug]/status`) -> Audio/Vibrate Call Alert -> Seated -> Completed.
- **Takeaway Journey**: Scan QR -> Service Select -> Menu Catalog -> Cart -> Order Review -> Place & Queue -> Ticket Tracker -> Pay at Counter -> Pickup Call Alert -> Completed.
- **Recovery & Resilience**:
  - Encrypted/signed HttpOnly cookie `qf_ticket_<restaurantId>` preserves ticket state across browser close/refresh.
  - Polling fallback automatically polls `/api/q/status` every 5 seconds if Realtime WebSocket disconnects.
  - Ticket verification uses cryptographic tokens hashed via SHA-256 in the database.

---

## 10. PAYMENT SYSTEM

- **External Gateway Status**:
  - **Stripe**: 0 references. Completely absent.
  - **Razorpay**: Mock / local HMAC stub only in `src/lib/payments/providers/razorpay-provider.ts`. No `razorpay` npm package installed.
  - **Live Gateways**: **NONE**.
- **Manual Payment Recording**:
  - Fully implemented via `ManualProvider.ts` for recording `CASH`, `CARD_PRESENT`, and `EXTERNAL_UPI` at the counter.
  - Full audit ledger in `payments` and `payment_events`.

---

## 11. NOTIFICATIONS & OUTBOX

- **Transactional Outbox**:
  - Events written to `outbox_events` table within database transactions.
  - Background cron worker processes outbox via PostgreSQL advisory lock and leasing RPC (`lease_outbox_events`).
- **Customer Notifications**:
  - Web Audio API synthesizer chimes (`playChimeSound`) and browser vibration (`navigator.vibrate`).
- **Staff Notifications**:
  - In-app toasts and notification counters via `/api/staff/notifications`.
- **External Channels (SMS/Email)**:
  - Methods in `NotificationService.sendExternalNotification` log payloads; real third-party dispatch APIs (Twilio, SendGrid) are not yet integrated.

---

## 12. REALTIME ARCHITECTURE

- **Channels**: Broadcast channels scoped to `restaurant:<id>:queue` and `ticket:<id>`.
- **Postgres Changes**: Dashboard subscribes to Postgres change events on `queue_entries`, `orders`, and `restaurant_tables`.
- **Resilience**: Customer components use WebSocket subscriptions paired with automatic HTTP polling fallbacks.

---

## 13. CRON & BACKGROUND JOBS

| Route | Trigger | Frequency | Purpose | Security |
| :--- | :--- | :--- | :--- | :--- |
| `/api/cron/queue-maintenance` | Vercel Cron | Every 1 min (`* * * * *`) | Expires no-show tickets, cleans up abandoned drafts, evaluates schedule states | Bearer `CRON_SECRET` |
| `/api/cron/notifications` | Vercel Cron | Every 1 min (`* * * * *`) | Leases and dispatches pending rows from `outbox_events` with exponential backoff | Bearer `CRON_SECRET` |

---

## 14. ANALYTICS & REPORTING

- **Service**: `AnalyticsService.ts` in `src/lib/services/`.
- **Metrics Calculated**:
  - Footfall volumes broken down by Dine-In and Takeaway.
  - Average queue wait times and seated dining durations.
  - Table turnover rate and seat occupancy percentages.
  - Cancellation and no-show rates.
  - Daily/hourly revenue aggregations and ticket sizes.
- **Reporting Interfaces**: `/dashboard/analytics` (restaurant level) and `/platform/footfall` (cross-venue platform level).

---

## 15. SECURITY AUDIT

- **Authentication & Sessions**: Supabase Auth with secure cookie exchange in Next.js Middleware.
- **Customer Verification**: Cryptographic 64-character hex tokens; only SHA-256 hashes are stored in the database.
- **Database Functions**: All PostgreSQL RPCs specify `SECURITY DEFINER` and lock down `SET search_path = public, pg_temp;`.
- **Row Level Security**: Enabled on all 26 database tables.
- **Review Items**:
  - Rate limiting uses an in-memory fallback when Redis is unconfigured, which does not synchronize across distributed serverless instances.
  - Staff invitation tokens have expiration checks but rely on manual link sharing rather than automated email delivery.

---

## 16. TEST COVERAGE

- **Test Suite**: Vitest (42 unit test files, ~465 tests).
- **Core Coverage**:
  - Queue FSM & Hardening: **GOOD COVERAGE**
  - Takeaway Subsystem (Phases 1–4): **GOOD COVERAGE**
  - Seating & Tables: **GOOD COVERAGE**
  - RBAC & Authorization: **GOOD COVERAGE**
  - Outbox Pattern: **GOOD COVERAGE**
  - Customer UX Journeys: **GOOD COVERAGE**
- **Gaps**:
  - Menu dashboard interactive UI forms (Service methods tested; React forms lack UI component tests).
  - External payment gateway integration tests (No live gateways exist to test).

---

## 17. ROUTE & PAGE INVENTORY

| Route Path | Auth Requirement | Target Audience | Primary Function | Key Components |
| :--- | :--- | :--- | :--- | :--- |
| `/` | Public | Public / Marketing | Marketing overview, CTA to sign in | `LandingHero`, `FeatureGrid` |
| `/login` | Public | Staff / Admin | Email & password authentication | `LoginForm` |
| `/auth/callback` | Public | System | Supabase session callback exchange | Route Handler |
| `/q/[slug]` | Public | Customer | Restaurant landing, service selection modal | `ServiceSelectionModal` |
| `/q/[slug]/status` | Public (Token/Cookie) | Customer | Live ticket status, wait time, calling alerts | `CustomerTicketView`, `AudioChime` |
| `/q/[slug]/menu` | Public | Customer | Takeaway menu browsing, category navigation | `CustomerMenuBrowser` |
| `/q/[slug]/order` | Public | Customer | Cart summary, takeaway customer checkout | `TakeawayCheckoutForm` |
| `/q/[slug]/payment` | Public (Token/Cookie) | Customer | Order invoice display, Pay at Counter guidance | `CustomerPaymentSummary` |
| `/dashboard` | Authenticated (Staff+) | Staff / Admin | Overview metrics, quick actions | `DashboardOverview` |
| `/dashboard/queue` | Authenticated (Staff+) | Staff / Admin | Live Dine-In and Takeaway queue controller | `LiveQueueTable`, `CallModal` |
| `/dashboard/tables` | Authenticated (Staff+) | Staff / Admin | Floor plan, table status grid, seating assignments | `TableGrid`, `AssignSeatingModal` |
| `/dashboard/kitchen` | Authenticated (Staff+) | Kitchen / Staff | Live order board, status progression (Pending -> Ready) | `KitchenKanbanBoard` |
| `/dashboard/menu` | Authenticated (Admin) | Admin | Category creation, item creation, stock toggles | `MenuCategoryList`, `MenuItemTable` |
| `/dashboard/staff` | Authenticated (Admin) | Admin | Staff list, member invitations, role management | `StaffMemberList`, `InviteModal` |
| `/dashboard/settings`| Authenticated (Admin) | Admin | Restaurant profile, takeaway toggle, seating mode | `RestaurantSettingsForm` |
| `/dashboard/payments`| Authenticated (Admin) | Admin | Payment ledger, manual recording, reconciliation | `PaymentLedgerTable` |
| `/dashboard/analytics`| Authenticated (Admin) | Admin | Wait time metrics, turnover rates, footfall charts | `TurnoverChart`, `WaitTimeGraph` |
| `/platform` | Super Admin | Super Admin | Multi-venue oversight, platform metrics | `PlatformMetrics` |
| `/platform/restaurants`| Super Admin | Super Admin | Restaurant onboarding, suspension, provisioning | `VenueListTable`, `CreateVenueModal` |
| `/platform/footfall` | Super Admin | Super Admin | Cross-restaurant analytics and footfall comparisons | `ComparativeFootfallChart` |
| `/platform/audit-logs`| Super Admin | Super Admin | Global security audit log viewer | `AuditLogViewer` |

---

## 18. SERVICE INVENTORY

Located in `src/lib/services/`:

1. **`QueueService`** (`queue-service.ts`): Canonical queue state machine, position calculation, ticket generation.
2. **`OrderService`** (`order-service.ts`): Server-authoritative order creation, price verification, status progression.
3. **`MenuService`** (`menu-service.ts`): Catalog queries, item creation, availability toggles, soft archival.
4. **`SeatingService`** (`seating-service.ts`): Table assignments, multi-table combinations, floor recommendations.
5. **`RestaurantAdminService`** (`restaurant-admin-service.ts`): Profile updates, hours configuration, seating modes.
6. **`NotificationService`** (`notification-service.ts`): Notification tracking, audio chime triggers, outbox enqueueing.
7. **`OutboxService`** (`outbox-service.ts`): Concurrency leasing, batch execution, exponential retry backoff.
8. **`PaymentService`** (`payment-service.ts`): Payment ledger tracking and manual payment recording.
9. **`SecurityService`** (`security-service.ts`): Token generation, SHA-256 hashing, permission evaluation.
10. **`AnalyticsService`** (`analytics-service.ts`): Wait times, turnover durations, footfall time slots.
11. **`QueueHealthService`** (`queue-health-service.ts`): Queue health scoring, stall detection, throughput warnings.
12. **`QueueScheduleService`** (`queue-schedule-service.ts`): Operating hours calculation and shift closure validation.
13. **`SuperAdminService`** (`super-admin-service.ts`): Multi-tenant venue onboarding and provisioning.
14. **`InventoryService`** (`inventory-service.ts`): Ingredient stock levels, threshold warnings, recipe linkages.
15. **`AuditService`** (`audit-service.ts`): Platform and venue security audit logging.
16. **`RedisService`** (`redis-service.ts`): Redis client wrapper with in-memory fallback.
17. **`RealtimeService`** (`../realtime/realtime-service.ts`): Supabase Realtime channel broadcast wrapper.
18. **`ManualProvider`** (`../payments/providers/manual-provider.ts`): Manual cash, card POS, and external UPI recording.
19. **`RazorpayProvider`** (`../payments/providers/razorpay-provider.ts`): Mock / local HMAC stub provider (no external API).

---

## 19. DUPLICATE & DEAD SYSTEM DETECTION

- **Razorpay Provider Stub**: `src/lib/payments/providers/razorpay-provider.ts` is a mock HMAC stub without external network calls.
- **Payment Gateway Webhook**: `/api/payments/webhook` returns 200 with mock payload verification; no live gateway connects to it.
- **Inventory Subsystem**: Database tables (`inventory_items`, `inventory_movements`, `menu_item_ingredients`) and `InventoryService` exist, but lack dashboard UI screens.
- **Duplicate Customer Ticket Systems**: **None**. Both Dine-In and Takeaway share `/q/[slug]/status` and `CustomerTicketView.tsx`.
- **Duplicate Order Systems**: **None**. All orders flow through `OrderService` and `orders`/`order_items` tables.

---

## 20. MASTER PRODUCT FEATURE MATRIX

| Feature | Status | Existing Implementation | Main Files | Customer | Staff | Admin | Database | Tests | Notes |
| :--- | :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| Restaurant Onboarding | ✅ | Implemented via Super Admin portal | `platform/restaurants/page.tsx`, `SuperAdminService` | ❌ | ❌ | ✅ | `restaurants` | ✅ | Full venue creation |
| Authentication | ✅ | Supabase Auth + Session Middleware | `src/middleware.ts`, `app/login/page.tsx` | ❌ | ✅ | ✅ | `user_profiles` | ✅ | Email/Password auth |
| RBAC Permissions | ✅ | Roles + Granular permission overrides | `SecurityService.ts`, `rbac.test.ts` | ❌ | ✅ | ✅ | `restaurant_memberships`, `permissions` | ✅ | Enforced at all layers |
| Restaurant Settings | ✅ | Profile, hours, seating mode, takeaway toggle | `dashboard/settings/page.tsx`, `actions.ts` | ❌ | ❌ | ✅ | `restaurants`, `restaurant_queue_hours` | ✅ | Real-time settings |
| QR Code Entry | ✅ | Dynamic slug resolution & QR scans | `app/q/[slug]/page.tsx`, `CustomerJoinFlow.tsx` | ✅ | ✅ | ✅ | `qr_scans`, `restaurants` | ✅ | Multi-tenant dynamic QR |
| Dine-In Queue | ✅ | Full party queue, estimated wait, calling | `QueueService.ts`, `dashboard/queue/page.tsx` | ✅ | ✅ | ✅ | `queue_entries`, `queue_events` | ✅ | Complete Dine-In flow |
| Takeaway Queue | ✅ | Phases 1–4 complete (no seating, Pay at Counter) | `takeaway-phase*.test.ts`, `q/actions.ts` | ✅ | ✅ | ✅ | `queue_entries.queue_type` | ✅ | Production-hardened |
| Queue FSM Transitions | ✅ | Strict state machine with cancellation/no-show | `queue-fsm.ts`, `QueueService.ts` | ✅ | ✅ | ✅ | `queue_entries.status` | ✅ | Audited state machine |
| Queue Hours & Schedules | ✅ | Day-of-week shift hours with timezone check | `QueueScheduleService.ts` | ✅ | ✅ | ✅ | `restaurant_queue_hours` | ✅ | Prevents off-hour joins |
| Queue Health Monitoring| ✅ | Stall detection, throughput alerts | `QueueHealthService.ts` | ❌ | ✅ | ✅ | `queue_entries` | ✅ | Warns on stalled queues |
| Calling & Alerts | ✅ | Web Audio chime, vibration, staff buzzer | `CustomerTicketView.tsx`, `dashboard/queue` | ✅ | ✅ | ✅ | `notifications`, `queue_events` | ✅ | Complete buzzer UX |
| Seating Allocations | ✅ | Simple & Strict modes, combinations, sharing | `assign_seating_atomic`, `SeatingService.ts` | ❌ | ✅ | ✅ | `active_seating_assignments`, `restaurant_tables` | ✅ | Blocked for Takeaway |
| Floor Plan Grid | ✅ | Table statuses, capacity badges, zone filters | `dashboard/tables/page.tsx` | ❌ | ✅ | ✅ | `restaurant_tables`, `restaurant_zones` | ✅ | Visual floor controller |
| Table Recommendations | ✅ | Optimal seating engine for party sizes | `SeatingService.getRecommendedTables` | ❌ | ✅ | ✅ | `restaurant_tables` | ✅ | Real-time suggestions |
| Menu Categories | ✅ | Category creation, active status toggle | `MenuService.ts`, `dashboard/menu/page.tsx` | ✅ | ❌ | ✅ | `menu_categories` | ✅ | Edit modal absent |
| Menu Item Creation | ✅ | Full creation with price, prep time, desc | `createMenuItemFormAction`, `MenuService.ts` | ❌ | ❌ | ✅ | `menu_items` | ✅ | Validated server action |
| Menu Item Availability | ✅ | One-click stock/availability toggle | `updateMenuItemAvailabilityAction` | ✅ | ✅ | ✅ | `menu_items.is_available` | ✅ | Immediate sync |
| Menu Item Archival | ✅ | Soft delete preserving order history | `archiveMenuItemAction`, `MenuService.ts` | ❌ | ❌ | ✅ | `menu_items.is_archived` | ✅ | Preserves FK relations |
| Menu Item Editing | 🟡 | Service method exists; Dashboard UI modal absent | `MenuService.updateMenuItem` | ❌ | ❌ | 🟡 | `menu_items` | 🟡 | Lacks UI edit form |
| Menu Image Upload | 🟡 | String URL column supported; no file uploader | `menu_items.image_url` | ✅ | ❌ | 🟡 | `menu_items` | ❌ | Needs storage bucket |
| Category/Item Reorder | 🟡 | DB sort columns exist; no drag & drop UI | `menu_categories.sort_order` | ✅ | ❌ | 🟡 | `menu_categories`, `menu_items` | ❌ | Numerical entry only |
| Customer Takeaway Order | ✅ | Multi-item cart, server pricing, atomic queue | `CustomerMenuBrowser.tsx`, `q/actions.ts` | ✅ | ❌ | ❌ | `orders`, `order_items` | ✅ | Stale-cart protected |
| Staff Counter Ordering | ✅ | Staff walk-in takeaway placement modal | `StaffTakeawayOrderModal.tsx`, `actions.ts` | ❌ | ✅ | ✅ | `orders`, `order_items` | ✅ | Counter walk-ins |
| Kitchen Kanban Board | ✅ | Status flow: Pending -> In Progress -> Ready | `dashboard/kitchen/page.tsx` | ❌ | ✅ | ✅ | `orders.status` | ✅ | Real-time board |
| Manual Payment Record | ✅ | Cash, Card POS, UPI recording at counter | `ManualProvider.ts`, `StaffTakeawayPaymentModal` | ❌ | ✅ | ✅ | `payments`, `orders.payment_status` | ✅ | Reconciliation ledger |
| Payment Gateway | ❌ | Zero active gateways; Razorpay is a mock stub | `razorpay-provider.ts` (mock only) | ❌ | ❌ | ❌ | `payments` | 🟡 | No live gateway SDK |
| Transactional Outbox | ✅ | Leased background dispatch with retries | `OutboxService.ts`, `lease_outbox_events` | ❌ | ❌ | ❌ | `outbox_events` | ✅ | High reliability |
| Realtime Updates | ✅ | Broadcast + Postgres changes + HTTP fallback | `RealtimeService.ts`, `useQueueStatus` | ✅ | ✅ | ✅ | Supabase Realtime | ✅ | Dual-mode fallback |
| Analytics & Reports | ✅ | Wait times, turnover, footfall, party size | `AnalyticsService.ts`, `dashboard/analytics` | ❌ | ❌ | ✅ | `queue_entries`, `orders` | ✅ | Metric aggregation |
| Inventory & Recipes | 🟡 | Schema and service exist; no UI pages | `InventoryService.ts`, DB migrations | ❌ | ❌ | 🟡 | `inventory_items`, `menu_item_ingredients` | ✅ | Orphaned backend |

---

## 21. WHAT IS ACTUALLY MISSING?

### A. ALREADY COMPLETE
- Complete Dine-In queue lifecycle, party size management, and state machine (`WAITING`, `CALLED`, `SEATED`, `COMPLETED`, `NO_SHOW`, `CANCELLED`).
- Complete Takeaway subsystem (Phases 1–4): `queue_type = 'TAKEAWAY'`, position isolation, seating exclusion, Pay at Counter, customer cart, buzzer calling, and atomic completion.
- Multi-table combination and seat-sharing PostgreSQL RPCs (`assign_seating_atomic`, `release_seating_atomic`).
- Server-authoritative order creation and price snapshotting in `order_items`.
- Staff kitchen management board (`/dashboard/kitchen`) and live order status progression.
- Transactional Outbox pattern with atomic leasing and background retry processing.
- Customer session recovery via secure HttpOnly cookies and token hashing.
- Complete RBAC model with granular permission overrides (`SecurityService`).
- Multi-tenant venue onboarding and management via Platform Super Admin.

### B. PARTIALLY COMPLETE
- **Menu Management UI**:
  - Menu item creation, stock availability toggle, and soft-archival are complete.
  - **Missing**: Dashboard UI Edit Modal for modifying item name, price, prep time, and description without having to re-create the item.
  - **Missing**: File upload widget for food images (currently accepts only raw image URL strings).
  - **Missing**: Interactive visual/drag-and-drop category and item reordering.
- **Payment Infrastructure**:
  - Manual cash/POS counter payment recording is complete.
  - **Missing**: Real, production-ready payment gateway integration (Razorpay is currently a mock HMAC stub; Stripe is absent).
- **Notifications**:
  - In-app audio chimes, browser vibration, and staff in-app notification toasts are complete.
  - **Missing**: Live external SMS or WhatsApp messaging providers (currently stubbed).
- **Inventory Subsystem**:
  - Database schema, tables, and `InventoryService` are implemented.
  - **Missing**: Dedicated staff/admin UI screens for inventory management, recipe creation, and stock adjustments.

### C. MISSING
- Payment Gateway SDKs (`razorpay` or `@stripe/stripe-js` npm packages).
- Supabase Storage bucket configuration and client hooks for image asset uploads.
- Customer self-serve item cancellation post-order placement (currently requires entire ticket cancellation).
- Menu modifiers, combo selections, and item customizer options (e.g., spice levels, add-ons).
- Customer feedback and rating prompt after ticket completion.

### D. NEEDS HARDENING
- **Rate Limiting**: `RateLimiter` relies on in-memory storage when Redis is not connected, which does not share state across serverless instances.
- **Audit Log Pruning**: The `audit_logs` table currently lacks a background partitioning or scheduled pruning job.
- **Staff Invitation Delivery**: Staff invitation records are created in the database, but rely on manual token delivery rather than automated transactional email dispatch.

### E. DO NOT TOUCH (STABLE CORE)
- **`assign_seating_atomic` & `release_seating_atomic` RPCs**: Battle-tested, concurrency-safe table assignment engine.
- **`complete_takeaway_atomic` RPC**: Production-hardened takeaway completion engine.
- **`QueueService` & FSM state transitions**: Canonical state machine with complete audit tracking.
- **`OrderService.createCustomerOrder`**: Robust server-authoritative pricing and snapshot engine.
- **Customer Ticket Verification**: Secure SHA-256 token hashing and HttpOnly cookie recovery architecture.

### F. RECOMMENDED NEXT DEVELOPMENT PHASES

#### 1. Admin Capability Gaps (Immediate Priority)
- Build the **Menu Item Edit Modal** and **Category Edit Modal** in `/dashboard/menu` connecting to existing `MenuService.updateMenuItem` and `MenuService.updateCategory`.
- Integrate Supabase Storage for direct image uploading from the dashboard menu manager.
- Implement category and item reorder controls in the menu dashboard.

#### 2. Product Capability Gaps
- Integrate an actual payment gateway SDK (Stripe or Razorpay) for restaurants wishing to enable optional digital pre-payment for Takeaway orders.
- Build the frontend UI for the existing `InventoryService` to enable live ingredient tracking and 86'ing (auto-marking items out of stock when ingredients run out).

#### 3. Operational Gaps
- Wire up a real SMS / WhatsApp provider (e.g., Twilio / Gupshup) inside `NotificationService.sendExternalNotification` to notify customers when away from the browser.
- Add automated email dispatch for staff onboarding and invitations.
