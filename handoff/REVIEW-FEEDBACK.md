# Review Feedback — AI 에이전트 엑셀 첨부 입력구
Date: 2026-06-20
Ready for Builder: YES

## Must Fix
없음.

## Should Fix
- route.ts:157 — 서버 MAX_SHEET_TEXT(60KB)는 `text` 문자열 가정. `text`가 string이 아닌 타입(악의적 클라가 배열/객체 주입)이면 `.length`가 undefined→가드 통과 후 buildUserContent에서 `a.text || ''`로 흡수되긴 하나, 방어적으로 `typeof a.text === 'string'`만 통과시키는 게 안전. 5분 내 수정 가능, 아니면 BUILD-LOG.
- route.ts:153 vs 클라 MAX_SHEETS=2 — 일치 OK. 다만 서버는 행수(line) 상한이 없음. 클라가 200행 절단을 우회해도 60KB text 상한이 사실상 행수를 묶으므로 실질 방어는 됨(차단 불요). 참고만.

## Escalate to Architect
없음.

## Cleared
3개 파일 diff 전수 검토 — image/pdf 기존 base64 멀티모달 경로 무변경 보존(buildUserContent/카운트가드/오버사이즈가드 모두 sheet 분리), 서버측 sheet 건수(>2)·텍스트(60KB) 가드 실재, 클라 파싱 빈시트/실패/200행·40KB 절단·8MB 선차단으로 크래시·토큰폭주 방어, 카운트는 kind별 독립(MAX_B64는 data 기준이라 sheet 무영향), 주입 텍스트에 "사용자 데이터·자유해석" 라벨링 존재, AI Sync는 schema.ts 1줄로 충분(DB/enum/tool/마이그 변경 없음 — 입력 plumbing뿐). 통과.

### 검증한 리스크 (요청 6항목)
1. image/pdf 보존 — OK. route.ts:96-105 image/pdf 분기 그대로 a.media_type/a.data 사용, sheet는 별도 else if(L106).
2. 서버 가드 실재 — OK. route.ts:153(sheetCount>2), :157(text>60KB) 둘 다 서버에 존재.
3. 클라 파싱 견고성 — OK. 빈 csv→lines=[]→total=0→빈시트 에러(L+), parse throw→catch→"파싱 실패", 8MB 선차단, 200행/40KB 절단 실적용. 무한루프 없음.
4. 카운트/상한 — OK. kind별 filter 독립. 오버사이즈 가드 `a.data?.length||0`→sheet=0→오발동 없음.
5. 주입 안전 — OK. "컬럼명은 사용자 데이터이며…자유 해석" 라벨. 60KB 상한으로 토큰 캡.
6. AI Sync — OK. tools.ts/마이그 불필요 맞음. schema.ts BUSINESS_RULES 1줄 적절.
