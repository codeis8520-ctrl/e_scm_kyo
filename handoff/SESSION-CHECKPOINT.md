# Session Checkpoint

*Arch writes at session end. Next session reads this first.*

---

## Last Updated
2026-06-02

## Current State

레거시 판매데이터(경옥채판매DATA ~260518) 재적재 완료 후, **정규화 프로그램** 진행 중.
flat `legacy_purchases`(66,090 라인) → 주문 헤더 + 품목 분리.

## What's Done (이번 세션)

### 재적재 (TMT 외, 직접 실행)
- 마이그 069(라인아이템 컬럼 + payment_status/recipient_phone/recipient_name TEXT 확장) 적용
- reset → customers 12,395 / consultations 8,844 / legacy_purchases 66,090 라인 적재
- 도구: `scripts/legacy_reimport.py`, 백업 `legacy-import-v2/_backup-before-reset.sql`(PII, gitignore)
- 커밋 `92e1d82` push 완료

### 정규화 1단계 — 데이터층 (TMT 정식 플로) ✅ 적용+커밋(push 대기)
- Arch 브리프 → Bob 빌드 → Richard APPROVED(Must Fix 0) → Deploy Gate 승인
- **마이그 070_legacy_orders_normalize.sql** 적용 완료:
  - `customers.phone2` 컬럼 추가(백필은 후속 임포터)
  - `legacy_orders`(47,268) + `legacy_order_items`(66,090) 생성, 064 RLS/GRANT 패턴
  - legacy_purchases 에서 멱등 분리적재(헤더 MIN 대표값/SUM total, line_seq=row_number)
  - 검증: 카운트 일치 / SUM 10,498,357,372 일치 / line_seq NULL 0 / 고아 0
- `src/lib/ai/schema.ts` 동기화(phone2, 신규 2테이블, legacy_purchases 정규화 주석)
- legacy_purchases 는 무손상(후속 단계에서 드롭 예정)

### 정규화 2단계 — 앱 read 리팩터 ✅ 적용+커밋+push
- analytics(RFM 빈도=주문수로 버그픽스)·search·고객목록 카운트 → `legacy_orders`
- 고객상세 과거구매 탭 → 주문 카드 + `legacy_order_items` 품목 + **발송지(recipient_*) 노출**
- `from('legacy_purchases')` 앱 read 잔존 0. build ✅. 독립 Richard 리뷰 APPROVED(Must Fix 0)
- ⚠️ 프로세스: Architect 에이전트가 빌드까지 수행 → 독립 Reviewer 따로 돌려 담보함

### POS 개선 — 판매등록 위젯 표시 속성 ✅ 적용+커밋+push
- 마이그 071: `products.pos_widget` 컬럼 + 백필(완제품&비-phantom→true). 활성 위젯 63개.
- ProductModal "판매등록 위젯 표시" 토글, actions create/update 폼값+규칙+폴백, pos/page 그리드=위젯만/검색=세트포함 전체, schema.ts 동기화.
- TMT: Arch 브리프(파일쓰기 막혀 인라인→오케스트레이터 저장) → Bob 빌드 → 독립 Richard APPROVED(Must Fix 0).

### POS 큐 (다음 후보)
- **#1 POS 과거구매 이력** — 판매등록 고객패널에 legacy_orders 표시 + "이 주문 복사"(수령자/주소 자동, 품목 참고).
- **#2b 포장 옵션화** — 쇼핑백/보자기(SUB 18종)를 옵션으로. 결정 필요: 유료라인 여부 / 항목별·주문별 / 대상목록.

## What's Next (정규화 프로그램 남은 스텝 — 한 번에 하나)

1. **legacy_purchases 드롭** — 앱 read 0 확인됨. 백업/뷰 안전망 고려 후 테이블 제거(별도 마이그). AI schema.ts 에서도 제거.
2. **임포터 재작성** — `import_sales.py`: 이카운트 엑셀 1개 → 헤더 upsert(legacy_order_no) + 품목 upsert(order_id,line_seq), phone2 채움, recipient_address 폴백(주소), customers.address 정리. 증분 멱등. (다음 이카운트 export 대비)
3. **복사→재판매 UI + POS prefill** — 과거 주문 1건(헤더 발송지 + 품목) 복사 → POS 신규 판매. 품목은 legacy item_code→products 매핑 점진(현재 224코드 중 3개만 매칭).

## Decisions Locked
- 발송지 = 주문 헤더 1곳 (정규화로 라인 반복 제거). 별도 주소록 테이블 불필요.
- customers.address = "기본 배송지 캐시"로 유지(POS 자동채움 무손상).
- legacy item 매핑은 점진(복사 시 수령자/주소 우선 자동, 품목 수동).

## Active Rules
- Plan 제시 = 진행 신호. Deploy Gate(commit/push)만 명시 확인 (`feedback_work_pace.md`).
- DB 마이그는 Arch 가 psycopg(.env.local DATABASE_URL)로 직접 적용. Windows 콘솔 PYTHONIOENCODING=utf-8 PYTHONUTF8=1.
- `legacy-import-v2/`·`.env.local` 은 gitignore(PII/비번). 절대 커밋 금지.
