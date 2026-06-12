# Review Request — Feature A Step 2: 다건 재고 소모 차감
Date: 2026-06-12
Ready for Review: YES

## Files Changed
- src/lib/actions.ts:1083-1181 — recordStockUsage(객체 인자) 신규. adjustInventory 바로 아래. 2-pass(검증+RAW/SUB 본사제한 전수 → 라인별 OUT 차감), 행없음 시 음수 quantity insert(abs 분기 복붙 안 함), inventory_movements OUT/USAGE/usage_type_id insert, revalidatePath + {success, count}.
- src/app/(dashboard)/inventory/StockUsageModal.tsx:1-302 — 신규 자체완결 모달(TransferModal 동형, 자체 fetch 없음). 지점 select(defaultBranchId 시 disabled) + 사용유형 dropdown(빈목록 안내+disable) + 공통 memo + 제품검색 다건 리스트(현재고 표시, 중복추가 방지, 비차단 초과 경고). recordStockUsage 호출.
- src/app/(dashboard)/inventory/page.tsx:8 — import StockUsageModal.
- src/app/(dashboard)/inventory/page.tsx:11 — import getInventoryUsageTypes.
- src/app/(dashboard)/inventory/page.tsx:133-134 — state showUsageModal + usageTypes.
- src/app/(dashboard)/inventory/page.tsx:172-180 — 첫 useEffect 에서 getInventoryUsageTypes() active 필터 로드(try/catch 폴백).
- src/app/(dashboard)/inventory/page.tsx:500-506 — '+ 입출고' 옆 '+ 소모 차감' 헤더 버튼.
- src/app/(dashboard)/inventory/page.tsx:902-911 — StockUsageModal mount(지점고정 사용자: branches 자기지점 필터 + defaultBranchId 강제).
- src/lib/ai/schema.ts:157 — BUSINESS_RULES 에 recordStockUsage 1줄 추가(DB_SCHEMA 무수정).

## Open Questions
- 모달 품목 검색 후보는 page 의 `inventories`(검색조건 매칭분) 한정 — 브리프 "page 가 이미 가진 데이터 주입" 설계 그대로. 재고화면에서 아무 검색도 안 한 상태면 후보가 빌 수 있음. 의도된 동작인지 확인 부탁(BUILD-LOG Known Gap 기재).
- RAW/SUB 제한에서 불필요 쿼리 절약 위해 branchId!=HQ 일 때만 라인별 product_type 조회하도록 했음(HQ면 어차피 통과). 브리프 L18 의미와 일치 판단했으나 검토 부탁.

## Out of Scope (logged in BUILD-LOG)
- 비트랜잭션 부분실패 자동 롤백 없음(pass2 도중 supabase 에러 시 앞선 라인 반영됨). 기존 코드 동일 한계. 사용자 거부는 전부 pass1.
- 소모 이력 보고/필터/조회 화면, CSV 다건 업로드, 사용유형별 통계 대시보드.
- tools.ts 에이전트 소모 WRITE 도구.
