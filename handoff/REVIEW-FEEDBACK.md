# Review Feedback — Cafe24 Bugfix (2 bugs, 1 step)
Date: 2026-06-12
Status: APPROVED

## Conditions
없음.

## Escalate to Arch
없음. (기존 0원 rows 백필 = FORWARD-ONLY, Project Owner 결정 — BUILD-LOG에 이미 기록됨. 코드 이슈 아님.)

## Cleared
Bug ② isNoSelection — 배열 분기(v='' → filter 드롭)·문자열 분기('' 반환, bare k 누출 없음) 양쪽 정상.
정상옵션(색상=레드) 무영향, 선택안함 pair 완전 제거, 전부 선택안함은 L293 `name xQty` 폴백(extractItemOptions 무변경).
=== 정확매칭(공백붕괴 후)이라 '선택안함' 부분문자열 포함 정상값은 잘못 드롭되지 않음.

Bug ③ firstPositiveAmount — Number() 변환·첫 유한+양수 반환·else 0 확인.
payment_amount=0|"0" → order_price_amount로 통과(핵심), payment_amount>0 무변경,
negative/NaN/""(=0)/null 모두 스킵, 전부 0이면 0 반환.
webhook total_amount·orders total_price 적용, 필드 우선순위 정확.
createSaleJournal(webhook L363)는 무변경 — DB row(order.total_amount)를 통해 보정된 금액 자동 수령(transitive). discount_amount 무변경.

헬퍼는 types.ts 단일 정의 → route.ts·webhook.ts import (중복 없음).
스키마/마이그 변경 없음, BUSINESS_RULES 1줄만 추가. sync-orders.ts 무변경, 기존 row 백필 없음 — 스코프 준수.
