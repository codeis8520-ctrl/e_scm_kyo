# Architect Brief — POS 큐 #1: 판매등록 고객패널 과거구매(legacy) 표시

## Goal
POS(판매등록) 고객 선택 시, 고객상세에만 있던 legacy_orders 과거구매 이력을 고객패널 탭에서도 볼 수 있게 한다. 표시 전용(read-only).

## 참고 패턴 (그대로 재사용 — 새 발명 금지)
`src/app/(dashboard)/customers/[id]/page.tsx`:
- L63~77: `LegacyOrder` / `LegacyOrderItem` 타입
- L228~233: legacy_orders 중첩 select (단, 거긴 .range(0,9999) — POS는 .limit(50)로 변경)
- L1167~1256: 주문 카드 렌더 (펼침 토글 / 발송지 줄 / line_seq 정렬 품목 / 합계·품목수)

## Build Order — 단일 파일: src/app/(dashboard)/pos/page.tsx

### 1) 타입 추가 (상단, 다른 interface 근처)
`LegacyOrderItem` / `LegacyOrder` 인터페이스를 customers/[id] L60~77과 동일하게 추가.
(필드: id, legacy_order_no, ordered_at, channel_text, branch_code_raw, branch?{name}, recipient_name, recipient_phone, recipient_address, payment_status, total_amount, source_file, legacy_order_items[])

### 2) history state 에 legacyOrders 추가 (L205~210)
state 타입에 `legacyOrders: LegacyOrder[];` 추가, 초깃값 `legacyOrders: []`.

### 3) setHistory 리셋 3곳 모두 `legacyOrders: []` 동기화 — 누락 금지
- L717 (loadCustomerHistory catch)
- L787 (clearCustomer)
- L1046 (그 외 리셋 지점)
- Flag: 3곳 다 안 고치면 TS 컴파일 에러 또는 잔재 버그. grep `setHistory(` 로 전수 확인할 것.

### 4) legacy 페치 추가 (loadCustomerHistory, L692 Promise.all)
Promise.all 배열에 세 번째 쿼리 추가:
```
supabase
  .from('legacy_orders')
  .select('id, legacy_order_no, ordered_at, channel_text, branch_code_raw, recipient_name, recipient_phone, recipient_address, payment_status, total_amount, source_file, branch:branches(name), legacy_order_items(line_seq, item_code, item_text, option_text, quantity, total_amount)')
  .eq('customer_id', customerId)
  .order('ordered_at', { ascending: false })
  .limit(50)
```
- Flag: 결과를 `(legacyRes.data || [])` 로 안전 추출 → setHistory 의 legacyOrders 에 넣기.
- Flag: 폴백 — 이미 함수 전체가 try/catch 로 감싸져 catch 에서 빈 배열 세팅됨. 테이블/컬럼 부재여도 catch 로 떨어져 조용히 빈 배열. **추가 try/catch 만들지 말 것.** (단 catch 의 legacyOrders:[] 만 잊지 말 것 = 3번 항목)

### 5) historyTab 타입 확장 (L211)
`useState<'consult' | 'orders'>` → `useState<'consult' | 'orders' | 'legacy'>`.

### 6) 탭 버튼 추가 (L1573~1579 "구매 이력" 버튼 옆)
"구매 이력" 버튼 다음에 동일 className 패턴으로 세 번째 버튼: `과거 구매 ({history.legacyOrders.length})`.
- 항상 노출(0건이어도 탭은 보이고 본문이 빈 상태).

### 7) 본문 렌더 (L1599 orders 분기 다음에 legacy 분기 추가)
`historyTab === 'legacy'` 분기. **좁은 패널용 컴팩트** — customers/[id] L1167~ 보다 간결하게:
- 빈 상태: `<p className="text-center text-slate-400 py-4">과거 구매 이력이 없습니다.</p>`
- 주문별 카드(`border border-slate-100 rounded p-1.5` 톤):
  - 헤더 줄: 일자(ordered_at slice(0,10)) · 지점(branch.name 배지/없으면 branch_code_raw) · 합계(원) · (품목수)
  - 발송지 줄(작게): recipient_name/phone/address — 각 빈값 '-', 셋다 빈값이면 "발송지 정보 없음"
  - 품목 펼침: 카드 클릭 토글. 펼치면 line_seq 순 품목(item_text / option_text / quantity / total_amount). customers/[id] L1183~1247 차용.
- 펼침: `expandedLegacy` 로컬 state(`Set<string>`) + 토글 헬퍼. loadCustomerHistory 진입부에서 `setExpandedLegacy(new Set())` 초기화.

## Out of Scope (넣지 말 것)
- "이 주문 복사 → 재판매" 버튼/applyCopy 연동 (후속 #3)
- 포장옵션·legacy_purchases 드롭·임포터
- legacy 검색 필터(좁은 패널 불필요 — 생략)
- 페이징/더보기 UI (최근 50건 limit, 초과분은 후속)
- src/lib/ai/schema.ts (이미 동기화 — 손대지 말 것)

## Acceptance
- `npm run build` 통과 (TS 에러 0).
- POS 고객 선택 → "과거 구매 (N)" 탭 노출, N=legacy 주문수(최근 50건 한도).
- 탭 클릭 시 주문 카드(일자·지점·합계·품목수 + 발송지 줄), 카드 클릭 시 품목 펼침(line_seq 순).
- legacy 0건 고객: 탭 보이고 "과거 구매 이력이 없습니다."
- 고객 변경/해제 시 legacyOrders·expandedLegacy 재로딩/초기화.
- 기존 "상담 이력"·"구매 이력"(sales_orders) 탭 무손상.

## 락한 결정
- legacy 페치 limit 50 (좁은 패널). 고객상세는 9999 유지 — POS만 50.
- 탭 항상 노출(0건이어도). 빈 상태 문구.
- 검색 필터·복사 버튼 없음(범위 밖).
- 폴백은 기존 함수 try/catch 재사용 — 신규 try/catch 금지.

## 에스컬레이션
없음. 패턴 확립, 표시 전용, 제품 행동 변경 없음. DB 변경 없음(마이그 불필요).
