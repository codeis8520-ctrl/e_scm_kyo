# Review Feedback — Step 2

Date: 2026-04-22
Status: APPROVED

## Conditions

없음.

## Escalate to Arch

- **`CampaignTab.tsx:310` `toDTLocal` (datetime-local input 경로)** — Bob이 미해결 질문으로 올린 사안. input value 생성과 onChange 해석이 쌍으로 묶여 있어 표시 레이어만 치환하면 브라우저 TZ가 KST가 아닌 사용자에게 저장값 왜곡 가능. 현재 경옥채 사용자 전원 KR 브라우저 가정이라 당장의 버그는 없으나, 글로벌 접근/해외 출장 브라우저 대비책으로 **Step 3 이후 별도 step에 올릴지** 판단 필요. 코드만으로 결정 불가.
- **`fmtKoreanDayKST` / `fmtKoreanMonthKST` 2종 유지 여부** — Brief 스펙 5종 외 추가된 한글 포맷터 2종은 체크리스트 #7("기존 한글 스타일 유지")과 에이전트 컨텍스트 자연어 품질 유지에 정당한 근거가 있어 이번 리뷰는 통과. 다만 장기 스탠스(유틸 최소화 vs 스타일 다양성 허용)는 제품 방향이므로 Arch 확인 권장.

## Cleared

- `src/lib/date.ts` 신규 — Brief 스펙 5종(fmtDateTimeKST, fmtDateKST, fmtTimeKST, fmtMonthKST, fmtDateTimeKSTWithSeconds) 전원 `Intl.DateTimeFormat` 모듈 상수 캐싱 + `timeZone: 'Asia/Seoul'` 명시 + null/undefined/''/Invalid Date → `'-'` 폴백 확인. `sv-SE` 로케일 선택은 ISO 형식 확보 목적으로 타당하며 실행 검증 결과 `"2026-04-22 14:30"`, `"2026-04-22"`, `"14:30"` 정확 출력.
- UI 치환 11개 파일 — 표시 경로만 치환, 비즈니스 로직 무변경.
- 드리프트 없음 — DB 쓰기 `toISOString()`, `.gte/.lte` 쿼리 인자, 쿼리 경계 helper `fmtDate(Date)`·`todayStr`·`daysAgo` 전부 보존. Cafe24/Solapi/sweettracker 경로 미변경.
- grep 전수 확인 — `toLocaleDateString` 전체 코드베이스 0건, UI용 `toLocaleString('ko-KR')` 0건. 누락 callsite 없음.
- 영수증 인쇄(`ReceiptModal`) — `dateStr`/`timeStr`이 render 전 계산되어 `printRef` innerHTML에 baked-in → 별도 window의 print 출력에도 KST 정상 반영.
- 에이전트 컨텍스트(`api/agent/route.ts`) — 서버(UTC) 의존 `toLocaleDateString('ko-KR', ...)`를 `fmtKoreanDayKST(now)`로 치환, 동일 서식 유지하면서 TZ 안정성 개선.
- `npx tsc --noEmit` 통과 (unused import 없음). Bob의 `npm run build` 통과 주장 별도 재검증 불필요.
- Step 3 스코프(쿼리 경계 KST 정합성) 침범 없음.
