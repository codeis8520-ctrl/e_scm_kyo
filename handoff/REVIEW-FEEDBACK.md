# Review Feedback — Sprint A (송장 보내는분=구매자명 + 품목명 제거)
Date: 2026-06-16
Status: APPROVED

## Conditions
없음.

## Escalate to Arch
없음.

## Cleared
shipping/page.tsx 4개 변경 전부 통과. 검증 내역:

- **A1 (보내는분=구매자):** L775~776 createShipment 가 sender_name=`order.orderer_name||''`,
  sender_phone=`order.orderer_phone||''` 로 매핑. orderer_*는 Cafe24OrderForShipping 타입(L36~37)의
  주문자(구매자) 필드로, recipient_*(수령자, L40~42)와 명확히 분리됨 → buyer≠recipient 분리 정확.
  주소 3인자(zipcode/address/address_detail)는 undefined 유지(L777~779). resolveSenderForRow(L357,370)가
  주소는 항상 출고지점에서 채우므로 구매자 주소가 송장에 새지 않음.

- **cafe24DefaultSender 제거:** useState 선언(구 L147~152), setter(구 L714), read(구 L770) 전부 삭제.
  grep 결과 cafe24DefaultSender/default_sender 0건. data.default_sender 페치 잔존하나 다른 소비자 없음.
  tsc --noEmit 0 에러.

- **A2 (품목명 비움 / RTC 유지):** L431 F열(품목명) `''` 로 변경. G열(내품명) `KX-${id...}` RTC 코드 무변경(L432)
  → import 매칭 보존. header 13개 컬럼(L414~420)·!cols 13개(L440~444)·rows 13개 셀(L429~436) 모두 불변.
  다른 컬럼 시프트 없음.

- **guardSenders:** 변경 없음(L388~399). sender_name 이 구매자명이어도 resolveSenderForRow 가
  name=sender_name||branch, phone=sender_phone||branch, address=branch 로 해결 → 유효행 통과,
  지점 발송지 미등록 시 빈 주소로 차단 동작 유지.

- **STORE(비카페24) 회귀 없음:** STORE 행은 branch_id 보유 → resolveSenderForRow 가 저장된 sender_*/지점에서
  해결. 이번 변경은 CAFE24 신규 행 생성 경로만 건드림. 회귀 없음.

- **Out of Scope 준수:** 기존 shipment 백필 없음, exportSelectedToExcel·리스트 items_summary 표시 무변경,
  DB/migration/schema.ts/tools.ts 미변경.
