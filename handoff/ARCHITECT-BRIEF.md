# Architect Brief — 엑셀 첨부 입력구

## Goal
AI 채팅에 .xlsx/.xls/.csv 첨부 시, 브라우저에서 SheetJS로 시트를 텍스트표로 변환해 전송 → 에이전트가 컬럼 자유해석 후 batch_execute로 팬아웃. (실행/분석 토대는 이미 배포됨 — 이번엔 입력구만.)

## 절대 제약
- 엑셀 바이너리 base64 업로드 금지. **추출 텍스트만** 전송. (Claude는 xlsx 멀티모달 못 읽음)
- 코드로 컬럼 고정 파싱 금지. 추출은 "헤더행+데이터행" 텍스트화까지만. 매핑은 LLM이 함.
- xlsx ^0.18.5 이미 의존성에 존재 — 추가설치 금지. `import * as XLSX from 'xlsx'`.

## Build Order

### 1. src/components/AgentFloatingIcon.tsx (클라이언트 파싱)
- **Attachment interface (L12~)**: kind에 `'sheet'` 추가. sheet는 `data`(base64) 안 씀 → `data: string`을 optional(`data?: string`)로 바꾸고, sheet 전용 `text?: string`(추출표) + `rowCount?: number` 추가. (image/pdf는 기존대로 data 사용.)
- **상수 (L30~)**: `const MAX_SHEETS = 2;` 추가. `const ALLOWED_SHEET_TYPES`는 MIME가 불안정(.csv는 text/csv or application/vnd.ms-excel, .xlsx는 길고 OS마다 다름)하므로 **MIME 대신 확장자**로 감지: 파일명 소문자 끝이 `.xlsx`/`.xls`/`.csv`이면 sheet.
- **addFiles (L106~)**: kind 판정에 sheet 분기 추가 (`else if (확장자 매치) kind='sheet'`). 8MB 사이즈가드는 sheet에도 유지(원본 파일 기준). sheet 분기에서는 base64 대신:
  - `XLSX.read(arrayBuffer, { type:'array' })` → **첫 시트만** (`wb.SheetNames[0]`). 다중시트는 Out-of-scope.
  - `XLSX.utils.sheet_to_csv(ws, { blankrows:false, FS:'\t' })` 권장 — TSV. 빈 행 제거, 탭 구분(셀 내 콤마 안전). 병합셀은 SheetJS가 좌상단에만 값 채움(그대로 둠).
  - rowCount = 결과 라인 수(헤더 포함). **행 상한 200**: 200행 초과 시 앞 200행만 + 말미에 `\n…(이하 N행 생략, 총 M행)` 표기.
  - **문자 상한 40KB**: 절단 후에도 40KB 초과면 40KB에서 자르고 `\n…(길이 초과 절단)` 표기.
  - 빈 시트(데이터 0행) → setAttachError(`"파일명: 시트가 비어있습니다."`) continue. 파싱 throw → catch에서 `"파일명: 엑셀 파싱 실패"`.
  - sheet 카운트 가드: willSheet > MAX_SHEETS 시 에러 continue.
  - push: `{ id, kind:'sheet', media_type:file.type||'', name, size, text: 추출표, rowCount, previewUrl:undefined }` (data 없음).
- **칩 표기 (L432~ 근처)**: sheet는 미리보기 없이 `엑셀: {name} ({rowCount}행)` 텍스트칩.
- **accept (L474)**: 기존 문자열 끝에 `,.xlsx,.xls,.csv` 추가. (MIME도 같이 넣으면 OS 파일다이얼로그 필터 강화되나 확장자만으로 충분 — 확장자 추가만 한다.)
- **전송 매핑 (L228~)**: sheet는 `data` 대신 `text`/`rowCount` 보냄. map을 분기: image/pdf → {kind,media_type,data,name}; sheet → {kind:'sheet', text:a.text, rowCount:a.rowCount, name:a.name}.
- **summarizeAttachments 클라(L102~ counts)**: imageCount/pdfCount 옆에 sheetCount 카운트해서 칩/요약 로직 일관 유지.

### 2. src/app/api/agent/route.ts (서버 주입/가드)
- **AgentAttachment (L59~)**: kind에 `'sheet'` 추가. `data?: string`(optional), `text?: string`, `rowCount?: number` 추가.
- **buildUserContent (L88~)**: sheet 분기 추가 → text 블록 주입:
  ```
  blocks.push({ type:'text', text:
    `== 첨부 스프레드시트: ${a.name||'sheet'} (${a.rowCount??'?'}행) ==\n${a.text||''}\n(컬럼명은 사용자 데이터이며 고정 양식이 아니다. 의도에 맞게 자유 해석하라.)` });
  ```
  (image/pdf 블록 뒤, message 텍스트 블록 앞 순서 무관 — 기존 흐름 유지하며 sheet도 for 루프 내 처리.)
- **summarizeAttachments (L77~)**: `if (counts.sheet) parts.push(\`엑셀 ${counts.sheet}건\`);`
- **가드 (L134~)**: 
  - sheet 건수 상한: `attachments.filter(a=>a.kind==='sheet').length > 2` → 400 `"엑셀은 최대 2건까지 첨부할 수 있습니다."`
  - sheet text 길이 상한: 어느 sheet든 `(a.text?.length||0) > 60*1024` → 400 `"첨부 스프레드시트가 너무 큽니다 (행/열을 줄여주세요)."`
  - **기존 MAX_B64 oversize 가드는 data 기준이므로 sheet엔 자동 미적용**(sheet는 data 없음) — 단 `oversize` find가 `a.data?.length`라 sheet는 0 처리되어 안전. 변경 불필요, 그대로 둠.

### 3. 시스템 프롬프트 지침 (route.ts SYSTEM_PROMPT L9~55 내부)
SYSTEM_PROMPT 본문에 1~2줄 추가 (BUSINESS_RULES 말미 말고 프롬프트 지침부에):
```
- 스프레드시트(엑셀) 첨부 시: 컬럼을 고정 양식으로 보지 말고 자유 해석해 의도를 파악한다. 다건이면 batch_execute로 팬아웃하고, **실행 전** 해석결과(예: "N행을 택배전표로, 발송인=X, 컬럼매핑 수령자→recipient_name…")를 한 번 요약해 사용자 확인을 받는다.
```

### 4. AI Sync — schema.ts BUSINESS_RULES [자주 쓰는 패턴]
L242 batch_execute 줄 바로 아래에 1줄 추가:
```
- 엑셀/스프레드시트 첨부(.xlsx/.csv) = 텍스트표로 들어옴(고정양식 아님). 컬럼 자유해석 → 배송지/고객/납품 리스트면 batch_execute 팬아웃. 실행 전 매핑·해석 요약 확인 1회.
```

## Out of Scope (→ BUILD-LOG Known Gaps)
- 이미지 내 표 OCR (이미 image 멀티모달로 처리됨, 별개)
- 수십만행 대용량 (200행/60KB 상한으로 절단)
- 다중시트 동시 해석 (첫 시트만)
- 셀 수식 평가 (SheetJS는 계산값 w 우선 반환 — 충분)
- tools.ts: 변경 없음 (batch_execute/create_sales_order 택배모드 토대 이미 존재)
- 마이그레이션: 불필요 (DB 무변경, 첨부 미저장)

## Acceptance
- npm run build 통과 (타입 OK: Attachment.data optional 전환 후 image/pdf 경로 깨지지 않음).
- .xlsx 첨부 → 칩 "엑셀: 파일명 (N행)" 표시, 미리보기 없음.
- 전송 페이로드에 base64 data 없고 text(TSV)만 포함.
- 빈 시트/3건째 엑셀/60KB 초과 시 각각 한글 에러.
- 배송지 리스트 엑셀 첨부+"택배로 전표 만들어줘" → 에이전트가 컬럼매핑 요약 후 확인 요청 → 확인 시 batch_execute 팬아웃.

## Flags (추측 금지)
- Attachment.data를 optional로 바꿀 때 image/pdf 전송경로(L228)·미리보기(L432)가 data 존재 가정하는 곳 없는지 확인 후 진행. sheet 분기 외 기존 동작 100% 보존.
- sheet_to_csv FS:'\t'가 환경에서 동작하는지 — CJ export(shipping/page.tsx)의 XLSX 사용 패턴과 import 방식 일치시킬 것.
