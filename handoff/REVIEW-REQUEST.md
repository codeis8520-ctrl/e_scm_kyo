# Review Request — 엑셀 첨부 입력구

Ready for Review: YES
Build: npm run build ✓ Compiled successfully (errors 0)

## 변경 파일 + 라인

### src/components/AgentFloatingIcon.tsx
- L4: `import * as XLSX from 'xlsx'` 추가 (CJ export와 동일 패턴).
- L13~22 Attachment interface: kind에 'sheet' 추가, `data` optional化, `text?`·`rowCount?` 추가.
- L31~ 상수: MAX_SHEETS=2, SHEET_MAX_ROWS=200, SHEET_MAX_CHARS=40KB, SHEET_EXTS, isSheetFile(확장자 판정), fileToSheetText(첫시트 sheet_to_csv TSV, 빈행제거, 200행/40KB 절단) 추가.
- counts: sheetCount 추가.
- addFiles: sheet 분기(확장자 감지→파싱→빈시트/실패 에러→push text·rowCount, data 없음). image/pdf 경로 무변경.
- 칩 렌더: a.kind==='sheet' → "엑셀: {name} ({rowCount}행)" 텍스트칩(미리보기 없음). image/pdf 분기 보존.
- accept: ,.xlsx,.xls,.csv 추가.
- 전송 map: sheet → {kind,name,text,rowCount}; image/pdf → 기존 {kind,media_type,data,name}.

### src/app/api/agent/route.ts
- AgentAttachment: kind 'sheet', media_type/data optional, text?·rowCount? 추가.
- summarizeAttachments: "엑셀 N건".
- buildUserContent: sheet → text 블록 주입("== 첨부 스프레드시트: name (N행) ==\n{table}\n(고정 양식 아님…)").
- 가드: sheetCount>2 / text>60KB → 한글 400 에러. 기존 MAX_B64(data 기준)는 sheet에 무영향(data 없음 → 0).
- SYSTEM_PROMPT 규칙 6: 엑셀 첨부 시 자유해석→batch_execute→실행 전 요약확인.

### src/lib/ai/schema.ts
- BUSINESS_RULES [자주 쓰는 패턴] batch_execute 줄 아래 엑셀→팬아웃 1줄.

## Self-review 답변
- Richard 첫 지적 예상: "서버 가드 누락" → 추가 완료(sheetCount>2, text>60KB).
- image/pdf 100% 보존: data optional 전환했으나 전송 map·buildUserContent·미리보기 모두 image/pdf 분기 그대로. data는 sheet에서만 비움.
- 빈 데이터/실패 UX: 빈 시트→"시트가 비어있습니다", 파싱 throw→"엑셀 파싱 실패", 3건째→"최대 2건", 60KB초과(서버)→"너무 큽니다". 모두 한글.
- 8MB 사이즈가드: sheet 원본 파일에도 적용(파싱 전).

## 미해결 질문
- 없음. (tools.ts·마이그레이션 무변경 — 토대 기배포)

## Brief 대비 체크
- [x] sheet attachment 스키마(text/rowCount, 200행/40KB)
- [x] 첫 시트만, sheet_to_csv TSV(blankrows:false)
- [x] route 주입 포맷 + 시스템 프롬프트
- [x] 가드(엑셀 2건, 클라40KB절단/서버60KB거부, 200행절단)
- [x] schema 1줄, tools 무변경
- [x] 마이그 불필요
