# 경옥채판매DATA 재적재 전략

소스: `경옥채판매DATA(~260518)_작업최종완료.xlsx` (단일 시트 `판매현황`)
기존 임포트(`전화번호_검색결과_최종.xlsx` + `구매내역.xlsx`)를 **전량 폐기**하고 이 파일 하나를 단일 진실 소스로 재적재.

---

## 1. 파일 실측 (66,094 데이터행 × 32컬럼)

| 항목 | 값 |
|---|---|
| **그래뉼래러티** | **라인아이템 단위** (1행 = 주문 내 품목 1줄) |
| 날짜 범위 | 2018-01-23 ~ 2026-05-18 |
| **고유 주문** | 47,271건 (키: `일자+순번+거래처코드`) |
| **고유 고객(정제 후)** | **12,393명** (한국 12,367 + 해외 26) |
| 무전화 라인(익명거래) | 16,649행 → 고객 생성 ❌, 구매만 보존 |
| junk 전화 라인(len<9 등) | 128행 |
| 품목코드 distinct | 225 (→ `products` 매핑 가능) |

### 컬럼 역할 분류
- **고객(구매자) 식별**: `고객명`(98.5%), `연락처(원본)`(67%, 한국식 010-…), `마이그레이션_핸드폰번호_1`(100%, digits·해외포함), `마이그레이션_핸드폰번호_2`(1%, overflow)
- **지점/채널**: `거래처코드`+`거래처명` (A0=청담점 … X9=하이산홍콩). `출고처`(코드), `담당자`
- **수령자(선물배송)**: `받는 분`/`받는 분 연락처`/`받는 분 주소` — 구매자≠수령자 케이스
- **품목/금액**: `품목코드`,`품목명`,`주문 옵션`,`수량`,`단가(vat포함)`,`단가`,`공급가액`,`부가세`,`합계`,`할인`,`외화금액`
- **상태/상담**: `수령현황`,`수령일자`,`결제정보`,`승인`,`상담내역`,`특이사항`,`생산전표생성`

### 거래처코드 → 지점 (실측 24)
```
A0 청담점        A1 한남점        B0 자사몰        B1 신세계몰
B2 롯데몰        C0 본사          C1 대전신세계    C2 강남신세계
C3 명동신세계    C4 대구신세계    D1 부산신세계(팝업) D4 광주신세계(팝업)
X1 잠실롯데      X2 광교갤러리아  X3 명동롯데(팝업) X4 한남나인원(팝업)
X5 강남신세계(팝업) X6 명동신세계(팝업) X7 도곡SSG    X8 대구신세계(팝업)
X9 하이산홍콩(팝업)
```
⚠️ 이전 `구매내역.xlsx`의 코드체계(A1(본사)/B1(한약국…))와 **완전히 다름** → 064 스크립트의 CASE WHEN 매핑은 폐기.

---

## 2. 핵심 전략 — 고객 중복 제거

**고객 식별 키 = 정규화 전화번호** (이름 아님).

```
canonical_phone = digits(마이그_1) || digits(연락처원본)
검증:
  · 한국:  10~11자리 & prefix(010/011/016~19/02/03x/04x/05x/06x/070)  → 'KR'
  · 해외:  9~13자리 (그 외)                                          → 'FOREIGN'
  · 그 외(len<9, 단일숫자 '1'/'2'/'3' 등)                            → 무효 → 익명 처리
```

- **1 전화번호 = 1 고객** → `customers.phone` UNIQUE 제약이 DB 레벨에서도 중복 차단.
- 한국번호 저장형식 `010-1234-5678`(앱·POS 검색 호환), 해외는 digits 보존 + `metadata.legacy_foreign_phone=true`.
- **고객명 정규화**(같은 폰에 변형 다수: `홍길동`/`홍길동 ○○상호`/`홍길동(…)` 형태):
  최빈 → 동률 시 최장. 나머지 변형은 `metadata.legacy_name_variants[]`에 보존.
- **주소**: 같은 폰 중 가장 긴(=완전한) 비어있지 않은 값.

### ⚠️ 수동 검수 필요 (자동 병합 위험) — `review-customers.csv`로 출력
- **공유 전화 21건**: 한 번호에 서로 다른 사람(예 한 번호에 A 97건 + B 1건 + C 1건 — 매장 대표번호 추정). 기본은 최빈 이름 채택하되 `review-customers.csv`로 사람 확인.
- 이름이 100+ 전화에 걸친 케이스(특정 담당자명이 94개 폰에 걸침)는 **선물 발송 계정** — 정상(번호별 = 다른 수령처). 병합 대상 아님 → 폰 키 유지로 자동 해결.

---

## 3. 구매내역 적재 — granularity 결정 (요input)

| 옵션 | 행수 | 장단점 |
|---|---|---|
| **A. 라인아이템 단위 (권장)** | 66,094 | 품목코드/단가/공급가/부가세 보존, 품목별 분석·`products` 매핑 가능. **`legacy_purchases` 컬럼 확장 필요(마이그 065)** |
| B. 주문 단위 집계 | 47,271 | 기존 064 스키마 그대로, item_text 합쳐 보존. 품목 디테일 손실 |

권장 **A**: `legacy_purchases`에 컬럼 추가
`legacy_order_no`(=일자+순번+거래처, 주문 묶음), `item_code`, `unit_price_vat`, `supply_amount`, `vat_amount`, `discount`, `recipient_name`, `recipient_phone`, `recipient_address`, `staff_code`.
→ 채택 시 **CLAUDE.md AI Sync 규칙**대로 `src/lib/ai/schema.ts` `DB_SCHEMA` 동시 갱신 필수.

- **지점 매핑**: `거래처코드`+`거래처명` 그대로 `branch_code_raw`에 보존 + `branches.name` 매칭으로 `branch_id` 채움(불일치 시 NULL, 후속 매핑). 실제 `branches.code` 표가 필요하면 Arch가 DB 덤프 제공.
- **익명 라인 16,649**: `customer_id=NULL`로 보존(매출 이력 유실 방지).
- 금액은 VAT 포함가 기준(사내 규칙), `합계`=total_amount.

---

## 4. 상담내역
`상담내역`(26.5%)은 주문 단위로 반복 → (고객, 텍스트) 중복 제거 후 `customer_consultations(type='LEGACY')` 적재. `_x000D_\n` 캐리지리턴 아티팩트 정리. 날짜 블록 있으면 파싱.

---

## 5. 확정 결정 (2026-05-30 락)
1. 구매 granularity = **A. 라인아이템 단위** (마이그 069 + ai/schema.ts 동기화 완료)
2. 공유전화 = **CSV 출력 후 자동 진행** (대표명=최빈, `review-customers.csv`)
3. 지점 매핑 = **지점명 자동매칭 + raw 보존** (`branches.name`=`거래처명`, 불일치 NULL)
4. 고객 초기화 = **전체 완전 초기화 유지** (포인트 전량 소멸 수용)

## 6. 생성 산출물 (실측)
`scripts/generate-sales-data-import.py` 1회 실행 → `legacy-import-v2/`
| 산출 | 수치 |
|---|---|
| customers (13파일) | **12,395명** (해외 26) |
| consultations (9파일) | 8,844건 |
| purchases (67파일) | **66,090 라인** |
| review-customers.csv | 17건 (공유전화 검수) |
| skipped-rows.csv | 4행 (임베디드 헤더/무효일자) |

⚠️ 주의: `010-0000-0000` 같은 placeholder 전화가 소수 섞여 서로 다른 사람을 묶을 수 있음 → review-customers.csv 에 노출되어 사람이 확인 가능.

## 7. 실행 순서 (Arch — Supabase)
```
0) 백업 스냅샷 (Supabase → Database → Backups)
1) 마이그 069_legacy_purchases_line_items.sql  (컬럼 확장)
2) reset-before-reimport.sql                   (고객/포인트/상담/legacy_purchases 전량 초기화)
3) legacy-import-v2/customers-*.sql             (12,395명)
4) legacy-import-v2/consultations-*.sql         (phone JOIN, LEGACY)
5) legacy-import-v2/purchases-*.sql             (라인아이템, phone JOIN + 지점명 매칭)
6) 전후 카운트 검증 (reset SQL 의 NOTICE / 적재 후 SELECT count)
```
순차 실행은 `scripts/run-legacy-purchases.py --dir legacy-import-v2 --pattern "customers-*.sql"` 등으로 재사용 가능(`DATABASE_URL` 필요).
