# 이카운트 과거 구매·생산 내역 이전 기준

> 대상: 매입 / 생산 / 재고 — 2018년 이후 이카운트 과거 데이터
> 작성일: 2026-06-16
> 결정 상태: **요약(집계) 이전 확정** (Project Owner)

---

## 1. 결정 요약

| 항목 | 결정 |
|---|---|
| 과거 구매(매입) 내역 이전 | **요약(집계) 이전** |
| 과거 생산 내역 이전 | **요약(집계) 이전** |
| 이전 범위 | 2018년 이후 |
| 이전 단위 | 전표 상세(라인 전량) 아님 — **집계(요약) 단위** |
| 현재고 처리 | 과거 전표와 무관하게 **현 실사 스냅샷 유지** (이전이 현재고를 바꾸지 않음) |

판매 데이터 이전(legacy_orders/legacy_purchases) 때와 **동일 원칙** — 이카운트 품목코드가 자체 시스템 products와 1:1 매핑되지 않으므로 **텍스트 기반 요약**으로 보존한다.

---

## 2. 배경 및 판단 근거

### 2-1. 현재고 무결성 — 과거 이전과 무관
- 현재고는 과거 매입·생산 전표의 누적이 아니라 **실사/스냅샷**으로 세팅되어 있다(판매 이전 때도 매출과 재고를 분리).
- 따라서 **과거 구매·생산을 옮기지 않아도 현재고는 깨지지 않는다.**
- 과거 이력의 가치는 **원가 추정 · 거래처 이력 · 생산 추이 분석**에 있다(재고 정합성이 아님).

### 2-2. 품목 1:1 매핑의 한계
- 이카운트 품목코드 ↔ 자체 products.code 가 완전 일치하지 않는다(판매 legacy와 동일 이슈).
- 전체 전표를 라인 단위로 옮겨도 품목은 **텍스트 수준**으로만 연결된다 → 상세 전표의 추가 가치가 낮고, 데이터량·정제 비용은 크다.
- → **집계 이전이 비용 대비 효용이 가장 높다.**

### 2-3. 미이전 시 리스크 (요약 이전으로 해소)
- 미이전 시: 제품별 누적 매입량·평균 단가, 거래처별 거래 이력, 생산 추이의 **연속성 단절**.
- 요약 이전으로 이 분석축은 보존하면서 정제 비용은 최소화한다.

---

## 3. 이전 범위 — 요약(집계) 단위

### 3-1. 구매(매입) 요약
- **제품별 구매 집계**: (제품 텍스트, 기간) → 총 수량, 총 금액, 평균 단가.
- **거래처별 구매 이력**: (거래처 텍스트, 기간) → 총 금액, 건수, 최근 거래일.
- 권장 집계 주기: **월 단위**(YYYY-MM). 필요 시 연 단위 롤업.

### 3-2. 생산 요약
- **생산일자별 생산 집계**: (생산일자 or 월, 제품 텍스트) → 총 생산 수량.
- BOM 원재료 소모 상세는 **이전하지 않음**(품목 미매핑·복잡도). 필요 시 별도 검토.

---

## 4. 제안 데이터 구조 (텍스트 기반 legacy 요약 테이블)

판매 legacy(legacy_orders) 패턴과 동일하게 **자체 운영 테이블과 분리**한다. 매출/재고/회계에 영향 없음.

```sql
-- 과거 구매 요약 (제품·거래처·월 집계)
CREATE TABLE legacy_purchase_summary (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period        TEXT,            -- 'YYYY-MM' (월 집계) 또는 'YYYY'
  supplier_text TEXT,           -- 거래처명(원본 텍스트)
  item_text     TEXT,           -- 품목명(원본 텍스트)
  item_code_raw TEXT,           -- 이카운트 품목코드(원본, 향후 매핑 후보)
  product_id    UUID REFERENCES products(id),  -- 매핑되면 채움(점진), 기본 NULL
  total_qty     NUMERIC,
  total_amount  NUMERIC,
  source_file   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 과거 생산 요약 (제품·일자/월 집계)
CREATE TABLE legacy_production_summary (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period        TEXT,            -- 'YYYY-MM-DD' 또는 'YYYY-MM'
  item_text     TEXT,
  item_code_raw TEXT,
  product_id    UUID REFERENCES products(id),  -- 점진 매핑
  total_qty     NUMERIC,
  source_file   TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
```
- RLS/GRANT는 064/079 패턴(anon, authenticated).
- product_id는 **점진적 매핑**(처음엔 NULL, 텍스트로 충분). 이카운트 품목코드→products.code 매핑표가 마련되면 백필.

---

## 5. 최소 필드 — 요청 항목 매핑

| 요청 항목 | 반영 위치 |
|---|---|
| 제품별 구매 수량·금액 | legacy_purchase_summary (item_text, total_qty, total_amount) |
| 거래처별 구매 이력 | legacy_purchase_summary (supplier_text 기준 집계) |
| 생산 수량 | legacy_production_summary (total_qty) |
| 생산일자별 생산 내역 | legacy_production_summary (period=일자/월) |

---

## 6. 필요한 이카운트 Export (Project Owner 준비)

1. **구매(매입) 내역** 2018-01 ~ 현재 — 일자, 거래처, 품목코드, 품목명, 수량, 단가/금액 컬럼 포함 엑셀.
2. **생산 내역** 2018-01 ~ 현재 — 생산일자, 품목코드, 품목명, 생산수량 포함 엑셀.

> 엑셀 컬럼 구성이 확정되면, 판매 legacy 임포터(scripts/generate-sales-data-import.py)와 동일 방식으로 **요약 집계 → SQL 생성 → 적재** 파이프라인을 구성한다.

---

## 7. 미이전 / 한계 (양해 사항)

- **전표 라인 상세는 이전하지 않음** — 집계만. 개별 전표 추적이 필요하면 이카운트 원본 참조.
- **품목 1:1 매핑은 점진** — 초기엔 텍스트(item_text/item_code_raw), products 매핑은 매핑표 확보 후 백필.
- **BOM 원재료 소모 상세 미이전** — 생산은 완제품 수량 집계만.
- **현재고는 과거 이전으로 바뀌지 않음** — 현 실사 스냅샷 유지.

---

## 8. 실행 단계 (제안)

```
① Project Owner: 이카운트 구매·생산 엑셀 export (2018+) 제공
② 컬럼 구조 확인 → 집계 규칙(월/일자, 거래처·품목 키) 확정
③ 마이그레이션: legacy_purchase_summary / legacy_production_summary 생성 (Arch)
④ 임포터 스크립트: 엑셀 → 월/제품/거래처 집계 → SQL 생성
⑤ 적재 + 검증(합계 대조)
⑥ 조회 화면: 매입/생산/제품 상세에 '과거 요약' 탭 또는 섹션(읽기 전용)
⑦ AI schema.ts 동기화(신규 2테이블)
```

> 본 문서는 **요약 이전 기준**을 확정한 것이며, ③~⑦의 실제 구축은 이카운트 export 확보 후 별도 스프린트로 진행한다.
