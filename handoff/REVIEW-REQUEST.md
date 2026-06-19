# Review Request — 온라인몰 탭 표시 강화 배지 2종 (#50)
Date: 2026-06-19
Ready for Review: YES

## Files Changed
- src/app/(dashboard)/shipping/page.tsx (cafe24 탭 테이블 행 렌더만, 2곳):
  - 품목 셀 collapsed 영역 (toggle 버튼 아래) — `unmapped = items.filter(i => i.product_code && !i.mapped_name).length`; unmapped>0일 때만 amber 배지 `⚠ 미매핑 N건`. 매핑완료/0건/품목코드없음은 무표시.
  - 마지막 컬럼 (`order.already_added`) — 기존 `추가됨`(badge-info)을 emerald `✓ 전표생성완료` 배지로 교체.

## 사용한 매핑상태 필드
- `order.order_items[].product_code` (있어야 매핑 대상 — 기존 L1223 `noCode` 분기와 동일 기준)
- `order.order_items[].mapped_name` (매핑되면 채워짐 — 기존 L1230 펼침 표시와 동일)
- `order.already_added` (route L390 existingShipments 산출 — 기존 값 재사용)
- 추가 쿼리/route.ts/DB/마이그/AI schema·tools 변경 0.

## Self-Review
- Richard가 먼저 볼 것: 미매핑 카운트 기준이 펼침영역(L1248)의 noCode 규칙과 일치하는가 → 일치(product_code 있는 품목만 카운트). emerald 전표완료 배지가 opacity-40 흐림과 충돌하는가 → 흐림은 브리프대로 유지, 배지는 흐림 안에서도 색 대비로 식별 가능.
- 모든 요구사항 구현: 배지1(미매핑만 amber, 매핑완료 무표시) ✓ / 배지2(✓ 전표생성완료 emerald, opacity-40 유지) ✓.
- 빈 데이터: items 0건 → unmapped=0 → 무표시(정상). already_added=false → 배지 무표시(정상).
- `npm run build`: ✓ Compiled successfully, 0 error.

## Open Questions
- 없음. (감사 E1 흐림완화·E3 매핑완료 양성표시는 브리프/감사 권장에 따라 의도적으로 미반영 — PO 결정사항.)

## Out of Scope (logged in BUILD-LOG)
- 없음. 보존영역 전부 무변경.
