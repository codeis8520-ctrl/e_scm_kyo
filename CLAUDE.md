# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands
```bash
npm run dev    # dev server localhost:3000
npm run build  # production build
npm run lint   # ESLint
```

## Stack
Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Supabase (PostgreSQL) · Cafe24

**경옥채 사내 통합시스템** — multi-branch pharmaceutical/wellness ERP/CRM/POS + AI Agent

## Auth
Custom session auth (bcrypt + crypto.randomBytes). Login → bcrypt password verify → httpOnly cookies.
Legacy SHA-256 hash users auto-migrate to bcrypt on login.
- Server-only: `session_token`, `user_id`
- Client-readable: `user_name`, `user_role`, `user_branch_id`

Middleware: `src/lib/supabase/middleware.ts` · Auth logic: `src/app/login/actions.ts`

## Roles
```
SUPER_ADMIN | HQ_OPERATOR | PHARMACY_STAFF | BRANCH_STAFF | EXECUTIVE
```
- `BRANCH_STAFF` / `PHARMACY_STAFF`: locked to their branch
- Nav filtered by `screen_permissions` table (`app/(dashboard)/layout.tsx`)

## Data Access
| Pattern | Where |
|---------|-------|
| Mutations | Server actions (`src/lib/*.ts`) → `revalidatePath()` |
| Server reads | `src/lib/supabase/server.ts` (SSR, cookie-aware) |
| Client reads | `src/lib/supabase/client.ts` → `useEffect` |
| API routes | Dashboard, Cafe24 webhooks/sync, Solapi, notifications batch |

Domain-specific actions: `actions.ts`, `purchase-actions.ts`, `production-actions.ts`, `return-actions.ts`, `notification-actions.ts`, `accounting-actions.ts`, `shipping-actions.ts`, `credit-actions.ts`, `cafe24-actions.ts`, `campaign-actions.ts`, `public-registration-actions.ts`, `inventory-actions.ts`, `notification-triggers.ts`, `notification-template-mapping-actions.ts`

## Key Tables (35+)
| Group | Tables |
|-------|--------|
| Core | `branches`, `products`, `inventories`, `inventory_movements` |
| Sales | `sales_orders`, `sales_order_items` |
| CRM | `customers`, `customer_grades`, `point_history`, `customer_consultations` |
| Purchase | `suppliers`, `purchase_orders`, `purchase_order_items`, `purchase_receipts` |
| Production | `bom`, `production_orders` |
| Returns | `return_orders`, `return_order_items` |
| Shipping | `shipments` |
| Accounting | `gl_accounts`, `journal_entries`, `journal_entry_lines`, `accounting_period_closes` |
| Notifications | `notifications`, `notification_templates`, `notification_template_mappings`, `notification_batch_logs`, `notification_campaigns`, `campaign_event_types` |
| Cafe24 | `cafe24_tokens`, `cafe24_sync_logs` |
| Auth | `users`, `session_tokens`, `screen_permissions` |

Schema: `supabase/schema.sql` · Migrations: `supabase/migrations/` (001~035)

## Business Rules
- Product creation auto-inserts `inventories` rows for every active branch (qty=0)
- Customer points: read latest `point_history.balance` (no total_points column)
- POS: `sales_order` → items → deduct inventories → movements(OUT) → point_history
- VAT: tax-inclusive pricing · supply = price ÷ 1.1 · VAT = price × 10/110
- Credit (외상): `payment_method='credit'` → must select customer → `credit_settled` tracking
- Cafe24 sales sync: cron daily (no customer auto-creation for privacy)
- Alimtalk: event-triggered auto-send via `notification_template_mappings` + `triggerEventNotification`

## Env Vars
```
NEXT_PUBLIC_SUPABASE_URL  NEXT_PUBLIC_SUPABASE_ANON_KEY
CAFE24_MALL_ID  CAFE24_CLIENT_ID  CAFE24_CLIENT_SECRET  CAFE24_SHOP_NO
SOLAPI_API_KEY  SOLAPI_API_SECRET  SOLAPI_SENDER_PHONE  SOLAPI_KAKAO_PFID
CRON_SECRET
SWEETTRACKER_API_KEY
```

## Public Routes (no auth)
`/login`, `/join/*` (QR signup), `/api/cafe24/*`, `/api/solapi/*`, `/api/webhooks/*`, `/api/notifications/batch/*`

## AI Agent
- 50 tools (`src/lib/ai/tools.ts`) including `analyze_data` (safe SQL)
- RBAC: `ToolContext` enforces branch/HQ restrictions
- Memory: `src/lib/ai/memory.ts` — alias/pattern/error/insight
- Route: `src/app/api/agent/route.ts` — agentic loop (max 6 iterations)

---

## Three Man Team — Multi-Agent Workflow

복잡한 작업을 3개 에이전트가 병렬로 처리하는 구성.

### 역할
| 역할 | 담당 |
|------|------|
| **Orchestrator** (메인) | 요청 분해 → 서브에이전트 위임 → 결과 통합 · 충돌 조정 |
| **Worker A** | 독립 worktree에서 기능 구현 (주로 UI/페이지) |
| **Worker B** | 독립 worktree에서 기능 구현 (주로 액션/DB) |

### 사용 기준
- 파일 겹침이 없는 독립 작업 2개 이상일 때만 병렬화
- 단일 파일 수정 작업은 병렬화 불필요

### Orchestrator 실행 예시
```
Agent(subagent_type="general-purpose", isolation="worktree",
  prompt="[Worker A] src/app/(dashboard)/X/page.tsx 에 ... 구현. 
          건드릴 파일: page.tsx, CustomerModal.tsx만")

Agent(subagent_type="general-purpose", isolation="worktree",
  prompt="[Worker B] src/lib/actions.ts 에 ... 액션 추가.
          건드릴 파일: actions.ts만")
```

### 규칙
1. 각 Worker에게 **건드릴 파일 목록을 명시** — 겹치면 병렬 불가
2. Worker는 commit하지 않음 — Orchestrator가 결과 검토 후 통합
3. DB 스키마 변경(migration)은 항상 Orchestrator가 직접 처리
4. 빌드 검증(`npm run build`)은 통합 후 Orchestrator가 실행
