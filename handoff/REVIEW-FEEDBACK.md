# Review Feedback — Step 2: 다건 재고 소모 차감
Date: 2026-06-12
Status: APPROVED

## Conditions
(없음)

## Open Questions 판정 (Bob 의 2건)
- 모달 후보 = page 의 검색조건 매칭 inventories 한정 → 검색 안 한 상태면 후보 빈다.
  브리프 L27("page 가 이미 가진 데이터 주입") 설계 그대로. 의도된 동작. 별도 fetch 추가는 브리프 위반이므로 추가 금지. Known Gap 기재로 충분. Arch 에스컬레이션 불필요.
- RAW/SUB 제한에서 branchId!=HQ 일 때만 라인별 product_type 조회 → adjustInventory 와 조회 순서 다르나 의미 동일(HQ 면 전부 통과, 비HQ RAW/SUB 만 거부). 정책 일관성 유지됨. 승인.

## Cleared
recordStockUsage 2-pass 검증→차감(pass1 전수통과 전 pass2 미진입 확인), 행없음 시 -item.quantity 음수 insert(abs 분기 미복붙), inventory_movements OUT/USAGE/usage_type_id insert, RAW/SUB 본사제한(adjustInventory 패턴 일치·폴백 동일), quantity 정수>=1·빈 items·branch/usage 필수 가드 전부 확인. StockUsageModal 주입데이터 자체완결(자체 fetch 없음)·지점고정 disabled·사용유형 빈목록 disable·초과경고 비차단·중복추가 방지 확인. page.tsx 배선(active 필터 is_active!==false 폴백, 지점고정 branches 필터+defaultBranchId 강제, RBAC 페이지게이트 상속·권한 회귀 없음) 확인. 마이그 079 가 usage_type_id FK 커버(신규 마이그 0). schema.ts DB_SCHEMA 무수정·BUSINESS_RULES 1줄만 추가. npm run build 통과.
