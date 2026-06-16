# Architect Brief — Sprint A (송장 보내는분=구매자명 + 품목명 제거)

## Goal
CJ(대한통운) 엑셀 export에서 보내는분 성명/전화가 **구매자(주문자)** 로 채워지고(현재 지점명 폴백으로 구매자 누락), **품목명 컬럼(긴 카페24 옵션 원문)이 빈칸**으로 나간다.

## Context (이미 조사됨 — 다시 읽지 말 것)
파일: `src/app/(dashboard)/shipping/page.tsx`
- `handleAddSelectedOrders` L772~ : 카페24 주문 → `createShipment` 생성. 현재 `sender_name: sender?.name||''`(L784, `cafe24DefaultSender` 사실상 빈값) → 구매자 누락.
  - 주문 객체 `order`에 `order.orderer_name`(L36), `order.orderer_phone`(L37) 가용. recipient는 별도 필드.
- `downloadCjExcel` L411~ : rows(L435-443). 컬럼 순서 = [받는분성명, 받는분전화, 기타연락처, 받는분주소, 배송메세지1, **F 품목명=`s.items_summary||''`(L438)**, **G 내품명=`KX-...` RTC코드(L439)**, 내품수량, 운임구분, **J 보내는분성명=sender.name(L441)**, 보내는분전화, 보내는분주소, 우편].
- `resolveSenderForRow` L367~ : 이름/전화 = `s.sender_name||지점명폴백`, 주소 = 항상 출고지점 발송지.
- `createShipment` (`src/lib/shipping-actions.ts` L11) `sender_name` 받음 — 시그니처 변경 불필요.

## Build Order
1. **A1 — 신규 카페24 shipment 보내는분=구매자** (`handleAddSelectedOrders` L781~793 루프 내 `createShipment` 호출):
   - `sender_name: order.orderer_name || ''`
   - `sender_phone: order.orderer_phone || ''`
   - sender 주소 관련 인자(`sender_zipcode/sender_address/sender_address_detail`)는 **현행 유지(빈값/undefined)** — 주소는 export에서 `resolveSenderForRow`가 출고지점으로 채움. 변경 금지.
   - L780 `const sender = cafe24DefaultSender;` 및 그것을 쓰던 sender_* 라인 정리. `cafe24DefaultSender`가 더 이상 안 쓰이면 선언/관련 dead code 같이 제거(빌드 경고 방지). 단 다른 곳에서 쓰면 두기 — grep 확인 후 처리.
2. **A2 — CJ 송장 품목명 비우기** (`downloadCjExcel` rows, L438):
   - F(품목명) `s.items_summary || ''` → **`''`(항상 빈 문자열)**.
   - **G(내품명) `KX-...` RTC 코드는 그대로 유지** — 임포트 매칭 필수. 절대 건드리지 말 것.
   - `header` 배열·컬럼 개수·순서 변경 금지.
3. **검증**: A1로 sender_name이 채워지면 `guardSenders`(L395) 가드는 정상 통과. 별도 수정 불필요 — 확인만.

## Out of Scope (BUILD-LOG Known Gaps 행)
- **기존(이미 빈 sender로 생성된) 카페24 shipment 자동 폴백 — 하지 않음.** [잠근 결정] shipments 테이블엔 buyer/orderer 컬럼이 없고(마이그 012), CAFE24 source는 `sales_order_id`=null, `getShipments`는 `select('*')` shipments 단독 — export 시점에 구매자명을 복구할 신뢰 가능한 소스 없음. **운영 워크어라운드: 해당 기존 행을 삭제 후 카페24 주문 탭에서 재추가하면 구매자명이 채워짐.**
- **품목명 짧은 이름 대체** — Sprint B(옵션조합→내부제품 매핑). 이번엔 비우기만.
- `exportSelectedToExcel`(L906~, '품목' 컬럼 L927)·배송 리스트 화면의 `items_summary` 노출 — **유지.** 이번 A는 **CJ export 출력만** 품목 제거.

## Acceptance
- 카페24 주문 신규 추가 → 생성된 shipment의 `sender_name`/`sender_phone` = 주문자(orderer). CJ export J열=구매자명.
- 구매자≠수령자 선물주문도 J열(보내는분)=구매자, 받는분=수령자로 정상 분리.
- CJ export F열(품목명) = 빈칸. G열(내품명) = `KX-xxxxxxxx` 유지.
- `header`/컬럼 개수 불변. 일반 엑셀 export·화면 품목 표시 불변.
- `npm run build` 통과. 미사용 `cafe24DefaultSender` 잔존 경고 없음.

## Files
- `src/app/(dashboard)/shipping/page.tsx` (A1·A2)
- DB/마이그/`schema.ts`/`tools.ts` 변경 **없음**.
