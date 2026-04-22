# Session Checkpoint

*Arch writes at session end. Next session reads this first.*

---

## Last Updated
2026-04-22

## Current State

Three Man Team 프레임워크 **실제 운영 개시** (cc5c9c1 적용 후 장기간 비활성 → 오늘부터 정상 가동).

직전 세션들에서는 단일 에이전트가 조사·빌드·커밋을 일괄 수행했으나, 2026-04-22부로 Arch→Bob→Richard 플로 복귀.

## What's Done (이번 세션)

### 통상 커밋 (TMT 미적용)
- `df21cef` fix(production): 생산 지시 목록 본사 필터 고정 문제 해결
- `6a273d4` feat(production): 생산 지시 목록 페이지네이션 + 상태전환 버튼 중복클릭 방지
- `01b1cfb` feat(inventory): 제품별 재고 변동 이력 화면 추가
- `dee1300` feat(inventory): 원자재·부자재 입출고·조정을 본사로 제한
- `0c04920` perf(db): 쿼리 핫패스 복합 인덱스 6개 추가 (마이그 055)

### TMT 플로 정식 적용
- `2a8e8a2` **Step 2** feat(i18n): KST 타임존 표시 레이어 표준화
  - Arch 설계 → Bob 구현(12파일 치환, `src/lib/date.ts` 신설) → Richard 리뷰(APPROVED 0 conditions) → 배포

## What's Next

### 즉시 후보
1. **Step 3** — KST 타임존 Phase B (쿼리 경계)
   - `.toISOString().slice(0,10)`, `startOfDay` 유사 패턴 → `kstDayStart/End`, `kstMonthStart/End`
   - 영향 경로: `ai/tools.ts`, `api/dashboard/route.ts`, `api/cafe24/members/route.ts`, `b2b-actions.ts`, `campaign-actions.ts`, `SalesListTab.tsx`, `agent-conversations/page.tsx` 등
2. **Step 1 재개** — POS 매출처 기본값 (HQ 역할 자동 선택 제거) · Brief 기작성
3. **마이그 055 Supabase 적용** — Arch 담당, 대형 테이블 CONCURRENTLY 권장

### Escalate (이번 세션 외 결정 필요)
- `CampaignTab.toDTLocal` datetime-local input TZ 처리 방식
- `fmtKoreanDayKST` / `fmtKoreanMonthKST` 장기 유지 여부

## Decisions Pending

- Step 3 를 곧 이어갈지 vs Step 1 먼저 처리할지
- POS 매출처 개선 방향 (HQ만 비우기 vs 전체 지점 선택 강제)

## Active Rules

- Plan 제시 = 진행 신호. 중간 확인 스킵, Deploy Gate(commit/push)만 명시 확인 (`feedback_work_pace.md`).
- DB 마이그레이션은 Arch가 Supabase SQL 에디터에서 직접 실행.
- `process.env.TZ` 전역 변경 금지 — 명시적 `timeZone: 'Asia/Seoul'`만 사용.
