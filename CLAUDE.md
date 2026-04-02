# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # Start dev server on localhost:3000
npm run build    # Production build
npm run lint     # ESLint (Next.js config)
```

There is no test runner configured.

## Architecture

**경옥채 사내 통합시스템** — ERP/CRM/Dashboard for a multi-branch pharmaceutical/wellness company.

**Stack:** Next.js 16 (App Router), TypeScript, Tailwind CSS v4, Supabase (PostgreSQL), Cafe24 e-commerce integration.

### Route Structure

- `src/app/(dashboard)/` — Protected routes behind role-based layout with sidebar nav
- `src/app/login/` — Public auth page using server actions
- `src/app/api/dashboard/` — Dashboard metrics aggregation endpoint
- `src/app/api/webhooks/cafe24/` — Cafe24 e-commerce webhook handler

### Authentication

**Custom session auth, not Supabase Auth.** Login validates `login_id` + SHA256 password against the `users` table, then sets httpOnly cookies:
- `session_token`, `user_id` — server-only verification
- `user_name`, `user_role`, `user_branch_id` — readable on client for UI filtering

`src/lib/supabase/middleware.ts` handles session refresh and redirect-to-login for unauthenticated requests. The actual auth logic is in `src/app/login/actions.ts`.

### Role System

```typescript
type UserRole = 'SUPER_ADMIN' | 'HQ_OPERATOR' | 'PHARMACY_STAFF' | 'BRANCH_STAFF' | 'EXECUTIVE';
```

- Navigation items filtered by `screen_permissions` table (queried in `app/(dashboard)/layout.tsx`)
- `BRANCH_STAFF` / `PHARMACY_STAFF` are locked to their assigned branch (`user_branch_id` cookie) — branch selectors are hidden or disabled for these roles
- HQ roles (`SUPER_ADMIN`, `HQ_OPERATOR`) see cross-branch data

### Data Access Patterns

- **Mutations:** Next.js server actions in `src/lib/actions.ts` — all CRUD goes here, ends with `revalidatePath()`
- **Reads in server components:** `src/lib/supabase/server.ts` (cookie-aware SSR client)
- **Reads in client components:** `src/lib/supabase/client.ts` (browser client), fetched in `useEffect`
- **API routes:** Used only for dashboard aggregation and Cafe24 webhooks

### Key Domain Tables

| Table | Purpose |
|-------|---------|
| `branches` | Store locations with channel type (STORE/DEPT_STORE/ONLINE/EVENT) |
| `products` + `inventories` | Product master + per-branch stock levels |
| `inventory_movements` | Audit log: IN/OUT/ADJUST/PRODUCTION |
| `sales_orders` + `sales_order_items` | Transactions from POS and online |
| `customers` + `customer_grades` | CRM with loyalty points |
| `screen_permissions` | Role → screen path access control |
| `cafe24_sync_logs` | Webhook processing audit trail |

Full schema in `supabase/schema.sql`.

### POS Checkout Flow

1. Create `sales_order` record
2. Create `sales_order_items`
3. Deduct from `inventories` + create `inventory_movements` (OUT)
4. Optionally create `point_history` for loyalty

### Cafe24 Webhook Flow

`POST /api/webhooks/cafe24` → verify HMAC-SHA256 signature → `Cafe24Client.getOrder()` → upsert `sales_order` (ONLINE channel) → log in `cafe24_sync_logs`. Status updates (`order.paid`, `order.shipped`, etc.) update the order record.

### Product Creation Side Effect

Creating a product automatically inserts `inventories` rows for every active branch (qty=0). This keeps inventory queries consistent across branches.

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
CAFE24_MALL_ID
CAFE24_CLIENT_ID
CAFE24_CLIENT_SECRET
CAFE24_SHOP_NO
```
