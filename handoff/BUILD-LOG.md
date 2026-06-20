# BUILD-LOG — 경옥채 시스템

## Step: AI 에이전트 엑셀 첨부 입력구
Date: 2026-06-20
Status: REVIEWED ✓ (APPROVED) — Deploy gate 대기

### Goal
AI 채팅에 .xlsx/.xls/.csv 첨부 → 브라우저 SheetJS로 첫 시트 TSV 추출(바이너리 미전송) → route가 text블록 주입 → 에이전트가 컬럼 자유해석 후 batch_execute 팬아웃. 분석·실행 토대(커밋 0ebd5cf)는 기배포, 이번엔 입력구만.

### 변경 파일
- src/components/AgentFloatingIcon.tsx (+79): XLSX import, Attachment 'sheet'(text/rowCount, data optional), 상수(MAX_SHEETS=2/200행/40KB), isSheetFile(확장자), fileToSheetText(sheet_to_csv TSV blankrows:false, 절단), addFiles sheet분기, 칩, accept, 전송map.
- src/app/api/agent/route.ts (+25): AgentAttachment 'sheet', summarize "엑셀 N건", buildUserContent text주입, 서버가드(sheet>2 / text>60KB), SYSTEM_PROMPT 규칙6.
- src/lib/ai/schema.ts (+1): BUSINESS_RULES 엑셀→팬아웃 1줄.

### 결정 (locked)
- 첫 시트만(다중시트 out-of-scope). sheet_to_csv + FS='\t'(TSV, 셀내 콤마 안전), blankrows:false.
- 시트 감지=확장자(MIME 불안정). 8MB 원본 사이즈가드 sheet에도 적용.
- 상한: 클라 200행/40KB 절단+경고, 서버 2건/60KB 거부. base64 MAX_B64 가드는 data기준이라 sheet 무영향.
- 바이너리 base64 미전송 — text(추출표)만 전송.
- tools.ts·마이그레이션 무변경(토대 기배포).

### Known Gaps (out-of-scope)
- 이미지 내 표 OCR (이미 image 멀티모달로 처리, 별개).
- 수십만행 대용량 (200행/40KB 절단).
- 다중시트 동시 해석 (첫 시트만).
- 셀 수식 평가 (SheetJS 계산값 반환으로 충분).

### Build
npm run build ✓ Compiled successfully (errors 0)
