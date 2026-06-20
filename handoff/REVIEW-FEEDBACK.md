# Review Feedback — 재사용 토대 2개 (택배 프리미티브 + batch_execute 팬아웃)
Date: 2026-06-20
Ready for Builder: YES

## Must Fix
(없음)

## Should Fix
(없음 — 인라인 수정 불요)

## Escalate to Architect
(없음)

## 중점 검토 결과 (7개 리스크 포인트 전수)

1. **batch_execute RBAC 상속** — 통과. execBatchExecute(tools.ts:3950)가 item마다
   `executeTool(tool, merged, sb, ctx)`로 동일 ctx를 그대로 전달. 대상 도구
   (execCreateSalesOrder→resolveBranchForWrite 등)가 자체 RBAC를 정상 수행.
   batch_execute 자체에는 별도 권한검증이 없으나 우회로가 아니라 위임 경로이며,
   각 item이 standalone 호출과 비트 단위로 동일한 검증을 받음.

2. **재귀/화이트리스트 가드** — 통과. 가드1(tools.ts:3917) self 차단 + 가드2(:3921)
   FANOUT_TOOLS 화이트리스트. batch_execute는 FANOUT_TOOLS(:1444)에 미포함 → 이중방어.
   비-FANOUT 도구·비등록 tool은 가드2에서 차단.

3. **confirm 1회** — 통과. batch_execute가 WRITE_TOOLS(:1416)·DANGEROUS_TOOLS(:1436)에
   등록 → route.ts:290에서 confirm 게이트 1회. 승인 시 route.ts:156이 executeTool로 직접
   실행하고, 내부 item executeTool 호출은 route 게이트를 거치지 않으므로 재확인 없음.
   confirm switch(:809)·success switch(:483) 모두 batch_execute case 존재·정상.

4. **토대 A 하위호환** — 통과. shipping 미지정 시 createSimpleSalesOrder(actions.ts:3039)가
   payload.shipping/shipFromBranchId를 설정하지 않음 → processPosCheckout의
   stockBranchId=(shipping && shipFromBranchId)?...:branchId(:2449)가 기존과 동일.
   택배 판정(:4012)은 recipient 3필드 중 하나라도 있으면 isParcel, 이때 3필드 전부 필수(:4013).
   2개만 지정 시 정확히 에러 반환. 빈틈 없음.

5. **부분실패·결과 압축** — 통과. item별 독립 try/catch(:3949), parse 실패도 failures로 흡수,
   한 건 실패가 루프를 죽이지 않음. 결과는 성공샘플 최대 5건·실패목록만 반환, route
   buildSuccessDetail도 실패 5건 슬라이스(:486). 컨텍스트 폭주 방지됨.

6. **AI Sync(schema.ts)** — 통과. BUSINESS_RULES 패턴(:241 택배 갱신, :242 batch_execute)
   추가됨. 신규 테이블/컬럼/enum 없음 → DB_SCHEMA 갱신 불요.

7. **processPosCheckout 필드명 일치** — 통과. createSimpleSalesOrder가 넘기는 shipping
   6필드(recipient_name/phone/address/zipcode/address_detail/delivery_message/delivery_type)가
   ShippingInfo(actions.ts:2392) 정의와 정확히 일치. shipFromBranchId도 CheckoutPayload(:2429)와
   일치. 오타·undefined 누락 없음. sender_*는 의도적으로 비움(CJ 폴백 정책 보존).

### 추가 확인
- 성공샘플 식별자 추출: create_sales_order→주문번호, create_b2b_sales_order→전표번호(:4446),
  create_customer→{성공,메시지}뿐이라 idOf(items[i]) 폴백(item.name 매칭). 3종 모두 정상.
- `npx tsc --noEmit` 0 error.

### 비차단 관찰 (Must Fix 아님 · 범위 외)
- create_customer(:2164)는 branch RBAC 미적용 plain insert. 단 이는 기존 standalone
  도구의 동작이며 이번 변경이 도입한 권한 격상 아님. 팬아웃은 동일 권한을 상속.
  필요 시 Arch가 별도 백로그로 판단.

## Cleared
토대 A(create_sales_order 택배 확장) + 토대 B(batch_execute 팬아웃)의 RBAC 상속·재귀가드·
confirm 1회·하위호환·부분실패·필드명 일치·AI Sync를 전수 검토했고, 7개 리스크 포인트 전부 통과.
