# Review Feedback — 판매상세 직접수정 (고객/수령일/받는분)
Date: 2026-06-16
Status: APPROVED WITH CONDITIONS

## Conditions
- src/lib/sales-revise-actions.ts:926 — shipments.recipient_* 동기화 update의 에러를
  검사하지 않고 결과를 버림(`await db...update(...)` 반환값 무시). 받는분 변경 시 sales_orders는
  이미 commit된 상태(L897~912)에서 shipment write가 실패하면 두 테이블이 어긋나고
  (배송 라벨과 전표 불일치), audit_logs에는 변경 성공으로 기록되어 부분상태가 추적되지 않음.
  형제 액션 convertOrderToParcel(L628~631)은 shipErr를 검사해 실패 시 error 반환함 — 같은
  패턴을 따를 것. 수정: L926의 update 결과 error를 받아, error면 사용자에게 알려지는 형태로
  처리(예: `{ error: '배송 정보 동기화에 실패했습니다.' }` 반환). audit는 실제 반영된 변경만
  기록되도록 shipment 실패 시 분기. (한 트랜잭션 RPC까지 요구하지 않음 — 최소한 에러 표면화.)

## Escalate to Arch
- 없음.

## Cleared
검토 통과 사항: requireSession이 모든 write 이전에 강제되고 미인증 시 DB 접근 전 error 반환(L831);
상태게이트(CANCELLED/REFUNDED/PARTIALLY_REFUNDED)가 mutation 이전에 차단(L867); order_number는
update payload·candidates에 부재 — 절대 불변 확인; updatePayload/recipientUpdate가 화이트리스트
배열(candidates/RECIPIENT_FIELDS)에서만 구성되어 임의 컬럼 주입 불가(L876~891, L915~918);
부분 diff — before===after는 스킵, 변경 0건이면 update·audit 모두 스킵하고 success(L887, L894);
customer_id는 nullable FK(schema.sql:241)로 존재하지 않는 id는 DB가 거부 — orphan 불가, ''→null
정규화 정상; writeAuditLog 시그니처(session.ts:65)가 실제 호출과 정확히 일치, 변경필드만 1건 기록
(한글라벨+사유+old/new); 42703 폴백이 조회·update 양쪽에서 isMissingColumnError로만 게이트되어
다른 에러는 흡수하지 않음(L846, L902); 드로어 UI — ✏️ 토글, 취소/환불 전표 비활성+안내문(L2056~2069),
고객검색은 /api/customers/search 차용(신규 모달 없음, L1909), 받는분 prefill shipment 우선(L1889~1893),
저장 시 updateSalesOrderDetails→loadDetail(true)+onChanged(L1936~1938); schema.ts:204 BUSINESS_RULES
1줄만 추가, tools.ts·마이그 무변경; 기존 드로어 기능(품목 추가/삭제, 전환, 취소, 수령상태) 회귀 없음;
npm run build ✓.

---

# Re-review — Must Fix 반영 확인
Date: 2026-06-16
Ready for Builder: YES

## Cleared (재검토)
Condition(L926) 해소 확인. L926 shipErr를 `{ error: shipErr }`로 캡처, L930 `if (shipErr)`로
검사 — 로깅만이 아니라 L934에서 `{ error: '받는분 정보의 배송 동기화에 실패했습니다.' }` 반환.
조기 반환이 audit(L941)·revalidatePath(L951) **이전**에 발생 → shipment 동기화 실패가
성공 audit로 기록되지 않음. 형제 convertOrderToParcel(L628~631: console.error+한글 error 반환)
패턴 일치. 다른 에러 흡수 없음 — happy path(shipErr falsy / shipment 없음 / 받는분 필드 무변경)는
정상적으로 audit+revalidate 진행, 42703 폴백은 여전히 isMissingColumnError로만 게이트(L902).
다른 변경 없음. npm run build ✓.
