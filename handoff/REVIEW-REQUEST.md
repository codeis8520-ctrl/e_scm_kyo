# Review Request — Batch 2b: AI 에이전트 배송 + B2B 도구 4종
Date: 2026-06-03
Ready for Review: YES

## Summary
에이전트에 4개 도구 추가(전부 기존 액션 래핑, DB 변경·신규 서버액션 없음):
- create_shipment (DANGEROUS) — createShipment 래핑, source='STORE'/sender 자동/created_by=ctx.userId
- create_b2b_sales_order (DANGEROUS) — createB2bSalesOrder 래핑, partner 인라인 조회, 단가 미지정 시 제품 정가
- settle_b2b_order (WRITE) — order_number→UUID 선조회 후 settleB2bOrder
- cancel_b2b_order (DANGEROUS) — order_number→UUID 선조회(settled>0 차단) 후 cancelB2bOrder

`npm run build` ✅ Compiled successfully in 7.6s (에러·경고 0).

## Files Changed
- src/lib/ai/tools.ts:1039-1135 — AGENT_TOOLS 4개 도구 정의(analyze_data 앞). create_shipment는 sender_*/source 파라미터 비노출(핸들러가 채움).
- src/lib/ai/tools.ts (WRITE_TOOLS/DANGEROUS_TOOLS) — WRITE +4, DANGEROUS +3(create_shipment/create_b2b_sales_order/cancel_b2b_order, settle 제외).
- src/lib/ai/tools.ts (executeTool switch) — 4 case 추가. settle/cancel은 ctx 미전달(전표 단위, 아래 Open Questions 참조).
- src/lib/ai/tools.ts (파일 끝) — execCreateShipment / execCreateB2bSalesOrder / execSettleB2bOrder / execCancelB2bOrder 핸들러 4종. 액션은 핸들러 내부 동적 import()(기존 컨벤션).
- src/app/api/agent/route.ts (buildConfirmDescription) — 4 case 추가(send_campaign 직후, default 앞). DANGEROUS 2차경고는 L292 기존 분기 자동, 구조 미변경.
- src/lib/ai/schema.ts — [자주 쓰는 패턴] +5줄, [B2B 거래] +6줄(상태흐름·납품·수금·취소), [배송] +1줄. DB_SCHEMA 무변경.

## 보안 리뷰 포인트 (발송·재무·재고 영향 — 필수)
- create_shipment: sender_*/source LLM 비노출 확인. staff는 resolveBranchForWrite로 본인 지점 강제. 지점 phone 없으면 sender_phone=''.
- create_b2b_sales_order: partner 인라인 `.or('name.ilike.%x%,code.eq.x')` — 미해결 시 한글 에러. RAW/SUB 차단·재고차감·분개는 액션 내부. 단가 미지정 시 products.price.
- settle/cancel: order_number→UUID **선조회 후 UUID 전달**(액션에 order_number 직접 전달 안 함). 핸들러 친절 차단(SETTLED/CANCELLED/settled>0) + 액션 이중 방어.

## Open Questions
- settle/cancel 핸들러에 ToolContext(ctx) 미전달(switch에서 sb,args만). 전표는 지점 무관 단위라 본인지점 강제가 부적합하다 판단 — 액션의 requireSession에 의존. 본사/staff 모두 전표번호만 알면 수금/취소 가능. RBAC 강화가 필요하면 지적 바랍니다.
- buildConfirmDescription은 브리프의 1줄 포맷 대신 기존 multi-line(lines.push/add) 스타일로 작성(파일 컨벤션 일치, 내용은 브리프 반영).

## Out of Scope (logged in BUILD-LOG Known Gaps)
- send_kakao 제외. B2B 단가표 연동·shipment 송장/SHIPPED 전환·deliveredAt 지정 미접촉.
