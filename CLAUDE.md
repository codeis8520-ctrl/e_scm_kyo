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
- Memory: `src/lib/ai/memory.ts` — alias/pattern/error/insight/summary
- Route: `src/app/api/agent/route.ts` — agentic loop (max 6 iterations)

### 🚨 AI Agent Sync — 절대 규칙 (매 수정 시 필수)

**에이전트는 실시간 스키마·비즈니스로직을 "내장 지식"으로만 동작한다.** 코드/DB가 바뀌었는데 에이전트 지식이 안 바뀌면 즉시 잘못된 SQL·응답을 뱉기 시작한다. 따라서 **어떤 변경이든 아래 매트릭스를 확인하고 같은 PR에 동기화해야 한다.**

| 이런 변경이 있으면… | 반드시 함께 갱신 |
|---|---|
| 새 테이블 / `ALTER TABLE` / 컬럼 추가·이름변경·타입변경 | `src/lib/ai/schema.ts` → `DB_SCHEMA` |
| 상태값(enum) 추가·변경 (status, type, channel 등) | `src/lib/ai/schema.ts` → `DB_SCHEMA` + `BUSINESS_RULES` 관련 섹션 |
| 워크플로우·정책 변경 (결제 흐름, OEM 전환, 등급 규칙 등) | `src/lib/ai/schema.ts` → `BUSINESS_RULES` |
| 기존 컬럼 **의미가 바뀜** (예: `shipments.branch_id`=판매→출고) | `DB_SCHEMA` 해당 라인에 주석 + `BUSINESS_RULES` 섹션 |
| 새 기능/액션을 에이전트가 호출할 수 있어야 함 | `src/lib/ai/tools.ts` 도구 추가 + RBAC + 필요 시 `WRITE_TOOLS`·`DANGEROUS_TOOLS` |
| 새 권한 역할·범위 변경 | `src/lib/ai/tools.ts` `ToolContext` 필터 |
| 자주 나오는 자연어 요청 패턴 발견 | `BUSINESS_RULES [자주 쓰는 패턴]` 한 줄 추가 |

**체크 프로세스 (모든 커밋 직전)**
1. 이 커밋이 DB/비즈니스 규칙/액션에 영향을 주는가? → YES면 위 매트릭스 대입
2. `src/lib/ai/schema.ts`·`tools.ts` 중 하나도 손대지 않았는데 영향이 있다면 **커밋 보류**하고 먼저 동기화
3. 마이그레이션 `.sql` 파일이 있으면 `DB_SCHEMA` 동기화는 **무조건** 필수 (Supabase 적용 시점과 무관하게 코드 먼저 반영)

**위반 예시 (과거 실수)**: 마이그 047(OEM)은 반영했지만, POS `shipFromBranchId` 추가 시 `shipments.branch_id` 의미 변경을 `DB_SCHEMA`에 주석으로 못 박지 않아 에이전트가 "출고 지점"을 "판매 지점"으로 해석할 위험이 남았다.

---

## Token Rules — Always Active

```
Is this in a skill or memory?   → Trust it. Skip the file read.
Is this speculative?            → Kill the tool call.
Can calls run in parallel?      → Parallelize them.
Output > 20 lines you won't use → Route to subagent.
About to restate what user said → Delete it.
```

Grep before Read. Never read a whole file to find one thing.
Do not re-read files already in context this session.

---

## Three Man Team

Based on [russelleNVy/three-man-team](https://github.com/russelleNVy/three-man-team).

### Roles
| Role | File | Job |
|------|------|-----|
| **Arch** (Architect) | `agents/ARCHITECT.md` | Plans, writes briefs, owns deploy |
| **Bob** (Builder) | `agents/BUILDER.md` | Builds exactly what brief says |
| **Richard** (Reviewer) | `agents/REVIEWER.md` | Validates quality, catches oversights |

### Handoff Files (`handoff/`)
| File | Flow |
|------|------|
| `ARCHITECT-BRIEF.md` | Arch writes → Bob reads |
| `REVIEW-REQUEST.md` | Bob writes → Richard reads |
| `REVIEW-FEEDBACK.md` | Richard writes → Bob reads |
| `BUILD-LOG.md` | Shared record, Arch owns |
| `SESSION-CHECKPOINT.md` | Arch writes at session end |

### Workflow
```
Arch: Brief 작성 → Bob 실행 (foreground)
Bob: 빌드 → npm run build → self-review → REVIEW-REQUEST.md
Arch: Richard 실행 (foreground)
Richard: diff 리뷰 → REVIEW-FEEDBACK.md
Bob: Conditions 수정 (있으면)
Arch: Deploy Gate → Project Owner 확인 → commit → push
```

### Rules
1. One step at a time — N+1 is blocked until N is deployed
2. Bob runs **foreground only** (background stalls on tool approval)
3. DB migration은 Arch가 직접 처리
4. 보안 민감 작업은 Richard 리뷰 필수
5. Out-of-scope → BUILD-LOG Known Gaps
