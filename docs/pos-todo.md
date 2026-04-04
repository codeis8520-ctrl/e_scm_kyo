# POS 관련 작업 예정

> 최종 업데이트: 2026-04-04

---

## 완료된 작업

- [x] POS 기본 결제 흐름 (현금/카드/카카오)
- [x] 바코드 스캔 + 제품 검색
- [x] 고객 연동 (포인트 사용/적립)
- [x] 빠른 고객 등록
- [x] 할인 기능 (금액 / % 토글)
- [x] 영수증 출력 (프린트)
- [x] 환불 처리
- [x] 모바일 슬라이드업 장바구니
- [x] VAN 카드 단말기 연동 인프라 구축
  - `src/lib/card-terminal.ts` 작성
  - 카드 결제 2단계 흐름 (승인 요청 → 결제 완료)
  - `sales_orders.approval_no` / `card_info` 컬럼 추가 (migration 011)
  - 영수증에 승인번호·카드정보 표시

---

## 대기 중 — VAN사 에이전트 수령 후 진행

### 1. 환경변수 설정
```
NEXT_PUBLIC_CARD_TERMINAL_URL=http://localhost:포트번호
```
- 포트번호는 VAN사 에이전트 설치 시 안내

### 2. 응답 필드명 검증 및 조정
- `src/lib/card-terminal.ts` → `pick()` 호출부 확인
- VAN사 에이전트 문서 기준으로 요청/응답 필드명 맞추기
- 테스트 항목:
  - [ ] 카드 승인 정상 흐름
  - [ ] 카드 승인 거절 처리
  - [ ] 타임아웃 처리 (기본 60초)
  - [ ] 카드 취소 (`requestCardCancel`) 환불 흐름 연결

### 3. Supabase migration 011 적용
```sql
-- Supabase SQL Editor에서 실행
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS approval_no  VARCHAR(20)  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS card_info    VARCHAR(100) DEFAULT NULL;
```

### 4. Windows 시작프로그램 등록
- VAN사 에이전트를 Windows 시작프로그램에 등록
- 단말기: O2CHECK SWT-3100A (LAN 연결)
- 에이전트가 localhost:포트 로 HTTP 서버 열어야 함

---

## 추후 검토 항목

- [ ] **할부 선택 UI** — 현재 일시불 고정, 필요시 3/6/12개월 선택 추가
- [ ] **카드 취소(환불) 자동 연동** — 현재 환불 시 VAN 취소 요청 미연결
  - `RefundModal` → `requestCardCancel()` 호출 추가 필요
  - 원승인번호를 `sales_orders.approval_no`에서 조회해 취소 요청
- [ ] **영수증 2장 출력** — 단말기 내장 프린터(고객용) + 브라우저 출력(점주용) 이원화
- [ ] **오프라인 모드** — 네트워크 단절 시 임시 저장 후 복구

---

## 단말기 정보

| 항목 | 내용 |
|------|------|
| 제조사 | O2CHECK |
| 모델 | SWT-3100A |
| 연결 | LAN (유선) |
| VAN사 | 확인 필요 — O2CHECK 고객센터 1588-1948 |
| 연동 방식 | 로컬 HTTP 에이전트 → `http://localhost:포트` |
