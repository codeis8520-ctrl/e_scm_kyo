# Review Feedback — Step 5
Date: 2026-04-22
Status: APPROVED

## Conditions
None.

## Escalate to Arch
- 거래처별 단가표(`/trade` Partners 탭의 `getPartnerPrices`/`bulkUpsertPartnerPrices`)에서도 RAW/SUB 노출 여부는 정책 결정 필요. OEM 위탁 생산에서 RAW/SUB 단가표 자체가 무의미하면 후속 Step으로 필터 추가. Brief 스코프 외.

## Cleared
`B2bSalesTab.tsx` L40-53는 `product_type` select + 042 폴백을 POS Step 4와 동일 구조로 구현했고, L58-60의 `productsData` 필터가 `setProducts`(L64) 단일 경로로 전파되어 `B2bSalesForm`의 제품 `<option>` 드롭다운(L298)에서 자동 제외된다. `createB2bSalesOrder` L161-172 가드는 partner 조회(L175), 총액 계산(L184), 전표번호 조립(L179), `b2b_sales_orders` insert(L206), `b2b_sales_order_items` insert(L228), 재고 차감(L231~), 분개 생성(L253~) 이전에 실행되어 DB 무변경 상태로 한글 에러("판매 가능한 제품이 아닙니다.")를 반환. `ptRes.error` 체크로 042 미적용 DB에서는 검증 스킵(운영 차단 방지). null은 `!== 'RAW' && !== 'SUB'`로 FINISHED 취급. `b2b_sales_order_items` insert 경로는 `createB2bSalesOrder` 하나뿐(Grep 결과 L228만 존재). AI tools에서는 b2b 읽기만 있고 write 경로 없음. 단가표·수금·취소·분개·POS·재고·생산·매입 무변경. diff 22+13줄 소규모.

---

### Drift check
- 변경 파일: `B2bSalesTab.tsx` + `b2b-actions.ts` 2개로 Brief 정확히 일치.
- Step 4 POS 패턴과 동일 구조 (pos/page.tsx:274-301, actions.ts:1111-1122).
- `handoff/ARCHITECT-BRIEF.md`·`REVIEW-REQUEST.md`는 프로세스 파일.
- Step 4(POS RAW/SUB 가드)와 정책 일관성 유지.
