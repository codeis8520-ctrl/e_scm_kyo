# Review Feedback — Step 4
Date: 2026-04-22
Status: APPROVED

## Conditions
None.

## Escalate to Arch
- B2B 판매 경로(`src/lib/b2b-actions.ts` → `b2b_sales_orders` / `b2b_sales_order_items` insert at L193, L215)는 `processPosCheckout` 가드의 적용 범위 밖이다. 현 Brief는 POS 스코프로 한정되어 Condition은 아니지만, OEM 위탁 생산 모델에서 B2B도 완제품 전용이라면 별도 Step으로 RAW/SUB 거부 블록을 `b2b-actions.ts` `createB2bSalesOrder` insert 지점에 추가해야 한다. 제품 정책 결정 필요.

## Cleared
`pos/page.tsx` L275-286는 `product_type` select + 042 폴백을 InventoryModal과 동일한 패턴으로 구현했고, L299-301의 단일 `productsData` 필터가 `setProducts`(L308) 및 `productMap`(L318 forEach) 양쪽에 그대로 전파되어 그리드·검색·바코드 Enter 매칭이 한 번에 차단된다. `processPosCheckout` L1111 가드는 재고 사전 확인(L1124), `sales_orders` insert(L1204), `sales_order_items` insert(L1317), 재고 차감·포인트 적립 이전에 실행되어 DB 무변경 상태로 한글 에러("판매 가능한 제품이 아닙니다.")를 반환하며, `ptRes.error` 체크로 042 미적용 DB에서는 검증 스킵(운영 차단 방지). null은 `!== 'RAW' && !== 'SUB'`로 FINISHED 취급. `actions.ts` 내 `sales_order_items` insert 경로는 `processPosCheckout` 하나뿐이며(Grep 결과 L1317, L1326만 존재) b2b는 별도 테이블 사용. 담당자/매출처/결제/배송/재고·생산·매입·BOM 화면 무변경. diff 22+13줄 소규모, unused import 없음.

---

### Drift check
- 변경 파일: `pos/page.tsx` + `actions.ts` 2개로 Brief 정확히 일치.
- `handoff/BUILD-LOG.md`·`REVIEW-REQUEST.md`·`.claude/settings.local.json`는 프로세스 파일이며 스코프 외 기능 변경 없음.
- Step 2(재고 RAW/SUB 가드) 및 기존 POS 결제 흐름과 충돌 없음.
