# Review Feedback — 판매현황 탭·필터 영속화 (req #12)
Date: 2026-06-16
Status: APPROVED

## Conditions
없음.

## Escalate to Arch
없음.

## Cleared
pos/page.tsx mainTab 복원과 SalesListTab.tsx 20필터 영속화를 리뷰함 — SSR 가드, 손상 JSON 폴백,
지점 사용자 branchFilter 잠금(저장값이 타 지점 노출 불가), debouncedSearch seed, compare 파생/모달
제외, 빈 localStorage 기본값 회귀 없음, DB/스키마/도구 무변경 모두 확인. 배포 가능.

## Detail (검증 근거)
- mainTab: readMainTab() window 가드+try/catch (page L23-30), lazy-init useState(readMainTab) (L329),
  저장 effect 1개 (L341-345). 기존 setMainTab('checkout') 3곳(L635/722/1471) 무수정 — effect 자동반영.
- 보안 잠금: branchFilter lazy-init `isBranchUser ? (userBranchId ?? '') : (saved.branchFilter ?? '')`
  (SalesListTab L179-180). setBranchFilter 유일 호출처는 `!isBranchUser` 게이트된 드롭다운(L942-943).
  지점 사용자는 변경 UI 없음 + 저장값이 init을 덮지 않음 → 오염된 localStorage로 타 지점 조회 불가.
  loadOrders 쿼리(L292)는 잠긴 branchFilter를 그대로 사용. (기존 client-enforced 자세 유지, 약화 없음.)
- readSalesFilters: window 가드 + JSON.parse try/catch + object 타입 체크, 실패 시 {} (L147-157).
- 20필터 lazy-init 전부 기존 기본값 폴백 (L173-208). 저장 effect 1개 + deps 20개 일치 (L221-235).
- debouncedSearch seed = saved.search (L184) → 첫 조회 stale empty 없음. debounce effect(L503)는
  이후 search 변경만 반영.
- compareBranchIds/compareRows/compareGrain/compareInit 미영속 (payload 제외) — 확인.
- window 무가드 useState initializer 없음.
- git diff: 소스는 두 파일만, DB/migration/schema.ts/tools.ts 무변경. 추가라인 전부 persistence 한정,
  드리프트 없음.
