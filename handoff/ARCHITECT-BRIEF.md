# Architect Brief — #46 배송메시지 ↔ 포장/옵션 분리

## Goal
송장 배송메모에 "[옵션] ..." 가 섞여 길어지는 문제 해소. 배송메시지 = 고객 직접입력 배송요청(문앞/부재시연락)만. 포장/옵션은 별도 컬럼/필드로 노출(여전히 보임). 저장 데이터 무변경(조회 도출 유지, #40 의도 보존).

## 배경 — 옵션이 배송메시지에 섞이는 지점 (전수 매핑)
| # | 면 | 지점 | 현 동작 | 옵션 출처 |
|---|---|---|---|---|
| 1 | **배송목록** 행 배송메모 | `shipping/page.tsx` L1623 `composeDeliveryMessage(s)` | base + `[옵션] optStr` 합성 | `getShipments` 도출 `order_options` (shipping-actions.ts L69~90: sales_order_items.order_option dedup) |
| 2 | **CJ export** 배송메세지1(5번째 컬럼) | `shipping/page.tsx` L499 `composeDeliveryMessage(s)` | 동일 합성 | 동일 |
| 3 | **카페24 탭** 배송메모 행 | `shipping/page.tsx` L1195 `order.delivery_message` (RAW, 합성 아님) | 합성 없음 | **cafe24 원본** `receiver.shipping_message` (orders/route.ts L373~378). cafe24가 메시지 안에 포장옵션을 넣어 보냄 → 우리 합성 아님 |

→ **우리가 합성하는 지점 = #1, #2 두 곳(composeDeliveryMessage)**. #3은 cafe24 원본 데이터 문제(별도 취급, 아래 Out of Scope 참조).

## Build Order
1. **composeDeliveryMessage 합성 제거** (`shipping/page.tsx` L150~166)
   - 함수를 **순수 배송메시지만 반환**하도록 변경: `return (s.delivery_message ?? '').trim();`
   - `items_summary` / `order_options` 인자·dedup 로직 제거. (호출처 2곳은 인자 객체 그대로 넘겨도 무해하나, 시그니처 단순화 권장.)
   - 주석 갱신: "#46: 배송메시지=순수 delivery_message. 옵션은 별도 컬럼."

2. **배송목록에 '포장/옵션' 컬럼 신설** (`shipping/page.tsx`)
   - thead: L1585 "배송메모" `<th>` 와 L1586 "품목" `<th>` **사이**에 `<th ...>포장/옵션</th>` 추가.
   - tbody: L1623(배송메모 `<td>`) 와 L1625(품목 `<td>`) **사이**에 옵션 `<td>` 추가. 내용 = `<TruncatedCell text={s.order_options ?? ''} className="text-violet-700" />` (없으면 빈칸/`-`). `order_options` 는 이미 `getShipments` 가 행에 실어줌(타입 L26 존재).
   - colSpan 쓰는 빈상태/소계 행 있으면 +1 보정(grep `colSpan` 으로 점검 — 배송목록 테이블 한정).

3. **CJ export 에 '포장/옵션' 전용 컬럼 추가** (`shipping/page.tsx` downloadCjExcel L482~512)
   - 배송메세지1 컬럼(L499 `composeDeliveryMessage(s)`)은 이제 순수 메시지만 들어감(1번 변경 효과). 옵션 빠짐.
   - **header 배열**(L482~488)에 옵션 컬럼명 추가. 위치 = '배송메세지1' 바로 **뒤**(6번째). 컬럼명: `'포장/옵션'`.
   - **rows 배열**(L496~504): `composeDeliveryMessage(s)` 다음 원소로 `s.order_options || ''` 추가.
   - **`!cols` 폭 배열**(L508~512)에 대응 원소 1개 추가(`{ wch: 18 }` 등) — 헤더/행/폭 3곳 길이 일치 유지.
   - Flag: **CJ 임포트가 컬럼을 이름 매칭이 아니라 위치(순서)로 읽을 수 있음** — '포장/옵션'을 표준 CJ 컬럼들 사이에 끼우면 CJ 프로그램이 깨질 위험. 따라서 **표준 CJ 컬럼은 순서 유지하고, '포장/옵션'은 맨 끝(보내는분우편번호 뒤) 추가** 안전. 단 packer가 배송메세지1 옆에서 보길 원하면 위치가 바뀜. → **Acceptance 에서 Project Owner 확인 필요(아래 Flag)**.

## Flag — Bob 가 추측 금지
- CJ '포장/옵션' 컬럼 위치: **(A) 배송메세지1 바로 뒤** vs **(B) 맨 끝(우편번호 뒤)**. CJ 프로그램이 표준 양식 컬럼 순서·개수에 민감하면 A가 양식을 깨뜨릴 수 있음. **기본 = B(맨 끝)로 구현**(안전). Project Owner 가 A 원하면 Deploy Gate 에서 조정. Bob 은 B로 빌드.
- 배송목록 컬럼 위치는 화면 전용이라 안전 → '배송메모'와 '품목' 사이(2번)로 확정.

## Out of Scope (→ BUILD-LOG Known Gaps)
- **카페24 탭(#3) 원본 message 파싱 분리**: cafe24 `shipping_message` 자체에 옵션이 섞여오는 경우. 우리 합성이 아니라 cafe24가 그렇게 보냄. 신뢰 가능한 split 패턴(예: `[옵션]` 마커)이 cafe24 원본에 **보장되지 않으므로** 이번 스텝에서 파싱 분리 안 함. 카페24 탭은 원본 그대로 표시 유지. (배송목록에 추가되면 우리 order_options 컬럼으로 분리되어 보임.)
- order_option **저장 스키마 변경** 없음 — 전부 조회 도출 유지(#40 원칙).
- items_summary 에 옵션이 텍스트로 박힌 과거 카페24 historical 행(sales_order 없음) — order_options NULL, 분리 불가(best-effort 한계). 현행 유지.

## 보존 (반드시 깨지면 안 됨)
- **#40 포장 가시성**: 옵션이 화면·송장에서 **사라지면 안 됨**. 배송목록 새 컬럼 + CJ export 새 컬럼으로 packer 가 계속 봄.
- 저장 데이터 무변경. `getShipments` order_options 도출 로직(shipping-actions.ts) **수정 금지**.
- CJ 표준 컬럼(받는분·보내는분 등) 순서·개수 무손상(Flag B 채택 시 보장됨). #30 내품명(G열) 빈칸 유지.

## AI Sync
- `src/lib/ai/schema.ts` L74 #40 주석에 **#46 분리** 한 줄 추가: "배송메시지=순수 delivery_message, 옵션은 별도 컬럼/필드(composeDeliveryMessage 합성 제거)."

## Acceptance
- 배송목록 행: 배송메모 셀에 "[옵션]" 문자열 없음. 별도 '포장/옵션' 셀에 보자기/쇼핑백/선물 등 표시.
- CJ export: 배송메세지1 셀 = 순수 고객 배송요청만. 별도 '포장/옵션' 컬럼(맨 끝)에 옵션. 표준 CJ 컬럼 순서 무손상.
- 카페24 탭: 현행 유지(원본 message, Out of Scope).
- `npm run build` 통과. order_options 도출(shipping-actions.ts) 무변경.
