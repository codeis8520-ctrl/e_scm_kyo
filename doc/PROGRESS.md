# 경옥채 사내 통합시스템 개발 진행 상황

**최종 업데이트**: 2026-04-02

## 프로젝트 개요

| 항목 | 내용 |
|------|------|
| 프로젝트명 | 경옥채 사내 통합시스템 (ERP + CRM + 대시보드) |
| 기술 스택 | Next.js 16, TypeScript, Supabase, Tailwind CSS |
| 배포 | Vercel |
| 데이터베이스 | Supabase (PostgreSQL) |

---

## 개발 로드맵 (PRD Phase 기준)

### Phase 1: 핵심 운영 기반 구축 ✅
- [x] FR-E01: 품목 등록/관리
- [x] FR-E02: 재고 확인, 입출고 관리
- [x] FR-E03: BOM 기반 생산 전산화
- [x] FR-E04: 백화점 판매 전표/POS 결제
- [x] FR-D01~D05: 대시보드 매출/재고 현황
- [x] FR-M01~M02: Cafe24 주문/배송 연동 (코드 완료, 설정 필요)
- [ ] 권한 관리 기본 구조 (NFR-A01~A03)

### Phase 2: CRM 통합 및 고객 관계 관리 ✅
- [x] FR-C01: 고객별 구매 이력 통합 조회
- [x] FR-C02: 고객별 상담 기록 및 특이사항
- [x] FR-C03: VIP 고객 분류 및 태그 관리
- [x] FR-C05: 담당자 변경 시 고객 맥락 유지
- [ ] FR-M03: 자사몰 고객 정보 CRM 연동
- [ ] FR-R03: 재고 부족 품목 자동 알림
- [ ] FR-R05: 대표/본사용 핵심 수치 요약 대시보드
- [ ] FR-S04: 시즌 전 생산/재고 준비 현황 점검

### Phase 3: 보고 자동화 및 시즌 운영 고도화
- [ ] FR-R01: 주간 및 월간 매출 요약 자동 생성
- [ ] FR-R02: 지점별 성과 비교 보고서
- [ ] FR-R04: 재구매 관리 필요 고객 목록 자동 추출
- [ ] FR-C04: 재구매 예상 시점 확인 및 알림
- [ ] FR-C06: 행사 초청, 후속 안내, 케어 이력
- [ ] FR-C07: 고객 수요와 상품/재고 운영 연결
- [ ] FR-S01~S03: 시즌별 목표/성과/후속 관리

---

## 완료된 작업 내역

### 2026-04-02

#### 1. 고객 등급별 적립율 추가
**파일 수정:**
- `supabase/schema.sql` - `customer_grades.point_rate` 필드 추가
- `src/lib/actions.ts` - `createCustomerGrade`, `updateCustomerGrade`에 point_rate 추가
- `src/app/(dashboard)/system-codes/page.tsx` - GradeModal에 적립율 입력 필드 추가

**적용 내용:**
- 등급 등록/수정 시 적립율(%) 입력 가능
- NORMAL: 1%, VIP: 2%, VVIP: 3% 기본값

#### 2. 고객 주소 필드 추가
**파일 수정:**
- `src/app/(dashboard)/customers/CustomerModal.tsx` - address 입력 필드 추가
- `src/lib/actions.ts` - `createCustomer`, `updateCustomer`에 address 추가

**적용 내용:**
- 고객 등록/수정 시 주소 입력 가능
- 택배 발송 기능 대비

#### 3. POS 화면 UI 개선
**파일 수정:**
- `src/app/(dashboard)/pos/page.tsx` - 고객 검색 및 바코드 스캔 개선

**고객 검색 개선:**
- 기존: 콤보박스로 전체 고객 선택 (불편)
- 개선: 이름 또는 휴대폰 뒷자리로 실시간 검색
- 동명이인 경우 드롭다운에서 선택
- 선택된 고객 표시 (등급 배지 포함)

**바코드 리더기 지원:**
- 전용 바코드 입력 필드 추가
- Enter 키 인식으로 자동 제품 추가
- 마지막 스캔 바코드 표시
- 바코드 → 제품 매핑용 HashMap 최적화

### 2026-04-01

#### 1. Cafe24 연동 구현 (FR-M01, FR-M02)
**파일 생성:**
- `src/lib/cafe24/types.ts` - Cafe24 API 타입 정의
- `src/lib/cafe24/client.ts` - Cafe24 API 클라이언트 (OAuth, REST API)
- `src/lib/cafe24/webhook.ts` - Webhook 핸들러 (주문 생성/상태변경)
- `src/app/api/webhooks/cafe24/route.ts` - Webhook API 엔드포인트
- `doc/CAFE24_SETUP.md` - Cafe24 연동 설정 가이드

**구현 기능:**
- Webhook으로 주문 생성 이벤트 수신 → `sales_orders` 테이블에 자동 저장
- `order.shipped` → SHIPPED, `order.delivered` → COMPLETED, `order.cancelled` → CANCELLED
- 고객 `cafe24_member_id` 매핑
- 모든 동기화 로그 `cafe24_sync_logs`에 기록

**API 수정 사항 (Cafe24 공식 문서 기준):**
- 응답 형식: `{ resource: { ... } }` 구조 반영
- Admin API 엔드포인트: `/admin/orders` 사용
- Rate Limit: Leaky Bucket (1초 2회)

#### 3. 폼 입력 검증 로직 추가

**파일 생성:**
- `src/lib/validators.ts` - 공통 검증 유틸리티

**검증 규칙:**
| 필드 | 검증 타입 | 설명 |
|------|----------|------|
| 전화번호 | `phone` | 01x-xxxx-xxxx 형식, 자동 포맷팅 |
| 이메일 | `email` | 이메일 형식 검증 |
| 필수값 | `required` | 빈 값 체크 |
| 양수 정수 | `positiveInteger` | 0 이상 정수 |
| 코드 | `code` | 영문, 숫자, -,_만 허용 |

**適용된 폼:**
- CustomerModal: 전화번호 자동 포맷팅 + 검증
- ProductModal: 필수값, 코드포맷, 가격 검증
- InventoryModal: 수량 검증
- NotificationsPage: 전화번호 검증
- ProductionPage: 생산 수량 검증

#### 4. 시스템 코드 관리 페이지 추가

**파일 생성:**
- `src/app/(dashboard)/system-codes/page.tsx` - 시스템 코드 관리 페이지
- `supabase/schema.sql` - customer_grades 테이블 추가

**구현 기능:**
| 구분 | 기능 |
|------|------|
| **지점 관리** | CRUD - 지점명, 코드, 채널(한약국/백화점/자사몰/이벤트), 연락처, 주소 |
| **고객 등급** | CRUD - 코드, 이름, 설명, 색상, 정렬순서 (NORMAL/VIP/VVIP) |
| **고객 태그** | CRUD - 이름, 설명, 색상 |
| **카테고리** | CRUD - 이름, 상위카테고리(계층형), 정렬순서 |

**DB 변경:** `customer_grades` 테이블 추가 (NORMAL, VIP, VVIP 기본 데이터)

#### 2. 대시보드 고도화 (FR-D01~D05)
**파일 생성:**
- `src/app/(dashboard)/DashboardClient.tsx` - 대시보드 클라이언트 컴포넌트
- `src/app/api/dashboard/route.ts` - 대시보드 데이터 API

**구현 기능:**
- **FR-D01**: 채널 필터 + 채널별 매출 위젯 (한약국/백화점/자사몰/이벤트)
- **FR-D02**: 지점별 재고 상태 표시 (정상/부족)
- **FR-D03**: 채널별 매출 비교
- **FR-D04**: 본사 뷰 ↔ 지점 뷰 토글
- **FR-D05**: 자사몰 온라인 매출 별도 표시 + 온라인 주문 배지

**UI 개선:**
```
[본사 뷰] [지점 뷰]    [전체] [한약국] [백화점] [자사몰] [이벤트]
┌──────────────────────────────────────────────────────────┐
│ 오늘매출 │ 이번달매출 │ 자사몰매출 │ 재고부족 │ 전체채널매출  │
├──────────────────────────────────────────────────────────┤
│ 채널별매출 │ 지점별재고 │ 최근주문(온라인배지)             │
├──────────────────────────────────────────────────────────┤
│ 재고부족 품목 그리드                                     │
└──────────────────────────────────────────────────────────┘
```

#### 5. 반응형 레이아웃 개선

**모바일/태블릿/데스크탑 대응:**
- 모바일: 햄버거 메뉴, 사이드바 drawer 형태
- 태블릿: 적응형 그리드
- 데스크탑: 고정 사이드바 + 콘텐츠 영역

#### 6. Phase 2 CRM 구현 (FR-C01~C05)

**파일 생성:**
- `src/app/(dashboard)/customers/[id]/page.tsx` - 고객 상세 페이지

**구현 기능:**
| FR | 기능 | 경로 |
|----|------|------|
| FR-C01 | 고객별 구매 이력 통합 조회 | `/customers/[id]` - 구매 탭 |
| FR-C02 | 고객별 상담 기록 추가/조회 | `/customers/[id]` - 상담 기록 탭 |
| FR-C03 | VIP 고객 태그 관리 | `/customers/[id]` - 태그 위젯 |
| FR-C05 | 담당자 지정/변경 | `/customers/[id]` - 담당자 지정 |

**고객 상세 페이지 기능:**
- 기본 정보 (이름, 연락처, 이메일, 등급, 담당지점)
- 구매 요약 (총 구매 횟수, 총 금액)
- 태그 관리 (추가/삭제)
- 구매 이력 탭 (최근 20건)
- 상담 기록 탭 (유형별 상담 추가)

**DB 변경:**
```sql
ALTER TABLE customers ADD COLUMN assigned_to UUID REFERENCES users(id);
```

#### 3. 환경변수 업데이트
`.env.local.example`에 Cafe24 관련 환경변수 추가:
```bash
CAFE24_MALL_ID=your_cafe24_mall_id
CAFE24_CLIENT_ID=your_cafe24_client_id
CAFE24_CLIENT_SECRET=your_cafe24_client_secret
CAFE24_SHOP_NO=1
```

---

## 파일 구조

```
src/
├── app/
│   ├── (dashboard)/
│   │   ├── page.tsx                    # 대시보드 (개선됨)
│   │   ├── DashboardClient.tsx         # 대시보드 클라이언트 (신규)
│   │   ├── pos/page.tsx                # POS
│   │   ├── products/page.tsx           # 제품 관리
│   │   ├── customers/page.tsx          # 고객 관리
│   │   ├── inventory/page.tsx           # 재고 관리
│   │   ├── production/page.tsx          # 생산 관리
│   │   ├── notifications/page.tsx       # 알림톡
│   │   └── branches/page.tsx            # 지점 관리
│   ├── api/
│   │   ├── dashboard/route.ts           # 대시보드 API (신규)
│   │   └── webhooks/
│   │       └── cafe24/route.ts         # Cafe24 Webhook (신규)
│   └── login/
├── lib/
│   ├── cafe24/
│   │   ├── types.ts                    # Cafe24 타입 (신규)
│   │   ├── client.ts                   # Cafe24 API 클라이언트 (신규)
│   │   └── webhook.ts                  # Webhook 핸들러 (신규)
│   └── supabase/
└── middleware.ts

supabase/
└── schema.sql                          # DB 스키마

doc/
├── 경옥채_사내통합시스템_PRD_v1.0.docx
├── 경옥채_사내통합시스템_TDD_v1.0.docx
└── CAFE24_SETUP.md                     # Cafe24 설정 가이드 (신규)
```

---

## Vercel 환경변수 설정 (필수)

Vercel Dashboard → 프로젝트 → Settings → Environment Variables에서 다음 추가:

| Name | Value | 비고 |
|------|-------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxx.supabase.co` | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` | Supabase anon key |
| `CAFE24_MALL_ID` | `yourmall` | 자사몬 몰 ID |
| `CAFE24_CLIENT_ID` | `BrIfqEKoPxeE...` | Cafe24 앱 Client ID |
| `CAFE24_CLIENT_SECRET` | `xxx...` | Cafe24 앱 Client Secret |
| `CAFE24_SHOP_NO` | `1` | 멀티쇼핑몰 번호 |

---

## 데이터베이스 테이블

| 테이블 | 용도 |
|--------|------|
| `branches` | 매장/지점 관리 |
| `users` | 회원/직원 관리 |
| `products` | 제품(품목) 관리 |
| `product_bom` | BOM (Bill of Materials) |
| `inventories` | 매장별 재고 |
| `inventory_movements` | 재고 입출고 이력 |
| `customers` | 고객 관리 |
| `customer_consultations` | 고객 상담 기록 |
| `customer_tags` | 고객 태그 분류 |
| `customer_tag_map` | 고객-태그 매핑 |
| `sales_orders` | 판매 전표 |
| `sales_order_items` | 판매 전표 항목 |
| `point_history` | 적립금 내역 |
| `production_orders` | 생산 지시서 |
| `seasons` | 시즌 관리 |
| `notifications` | 알림톡 내역 |
| `cafe24_sync_logs` | Cafe24 동기화 로그 |

---

## 알려진 문제점

1. **ESLint 에러**: 기존 파일들에서 `any` 타입 사용 및 `useEffect` 내 setState 관련 경고 (수정 필요)
2. **Cafe24 연동**: 실제 연동을 위해 Cafe24 개발자센터에서 앱 설정 필요
3. **notification-actions.ts**: Supabase 타입 에러 발생 중

---

## Git 커밋 이력

| 날짜 | 내용 |
|------|------|
| 2026-04-01 | Cafe24 연동 + 대시보드 고도화 |
| (이전) | Phase 1 기본 기능 (ERP, POS, 제품/고객/재고/생산 관리) |

---

## 다음 작업

1. **Phase 2 CRM** - FR-C01~C05 구현
   - 고객별 구매 이력 통합 조회
   - 상담 기록 및 VIP 태그 관리

2. **ESLint 수정** - 기존 코드 any 타입 및 useEffect 경고 해결

3. **Cafe24 연동 설정** - Vercel 환경변수 + 개발자센터 앱 설정
