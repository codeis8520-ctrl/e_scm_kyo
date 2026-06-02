# Review Feedback — POS 판매등록 위젯 표시 속성 (pos_widget)
Date: 2026-06-02
Ready for Builder: YES

(독립 검증 — git diff HEAD + 071 SQL + pos/page.tsx 로드·Enter·productMap 경로 직접 대조.)

## Must Fix
없음.

## Should Fix
없음.

## Escalate to Architect
없음.

## Cleared
5개 파일 전부 brief 그대로. 7개 체크포인트 통과:

1. 그리드/검색 분리 — filteredProducts(L624-626): 검색 없음→pos_widget(undefined||true)만, 검색 중→RAW/SUB 제외 전체에서 name/code 매칭(세트 포함). 바코드/Enter 등록은 productMap(전체 리스트, code+barcode 키) 우선 조회 → 세트도 무변경 등록 가능.
2. 폴백 — pos select 071→042→base 3단; pos_widget===undefined=전부 노출; actions create/update 양쪽 pos_widget delete-retry.
3. 기본값 규칙 — 백필 SQL·create 폴백·update 폴백 모두 (FINISHED & !is_phantom) 동일. 편집은 폼값 우선이라 기존값 보존.
4. 마이그 SQL — ADD COLUMN IF NOT EXISTS NOT NULL DEFAULT false(기존행 default 선충전) 후 백필 UPDATE. 적용 시 깨질 위험 없음.
5. 폼/직렬화 — 체크박스 !!formData.pos_widget 바인딩, Object.entries 루프(L317-321)가 boolean→String(value) 항상 append(false도 "false" 전송), 토글이 product_type 조건 밖이라 전 유형 노출.
6. 범위 가드 — schema.ts pos_widget 한 줄만, legacy_*·포장옵션 미접촉.
7. RBAC — 생성/수정 권한 가드(변경 구간 위쪽) 무변경.

빌드 ✓.
