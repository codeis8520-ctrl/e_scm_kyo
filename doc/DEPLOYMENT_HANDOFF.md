# 시스템 이전 및 운영 가이드

## 경옥채 사내 통합시스템 — 개발 환경 → 고객사 인프라 이전

---

## 1. 현재 구성 (개발·테스트)

```
[개발자 GitHub]                       [개발자 Vercel]
  codeis8520-ctrl/e_scm_kyo  ──배포──→  e-scm-kyo.vercel.app
                                         (Hobby 무료)

[개발자 Supabase]
  개발/테스트용 프로젝트
```

---

## 2. 이전 후 목표 구성 (운영)

```
[고객사 GitHub 레포]                  [고객사 Vercel]
  경옥채/e_scm_kyo    ──자동배포──→   erp.경옥채.com (또는 xxx.vercel.app)
       │                                (Pro $20/월 권장)
       │
  개발자 = Collaborator (Write)
  → git push 하면 자동 배포

[고객사 Supabase]
  운영용 프로젝트 (Free 또는 Pro $25/월)
```

---

## 3. 이전 절차 (약 1시간)

### 3-1. 고객사 계정 생성

| 순서 | 서비스 | 작업 | 소요 |
|---|---|---|---|
| 1 | GitHub | 고객사 이메일로 계정 생성 | 5분 |
| 2 | GitHub | 새 Private 레포 생성 (예: `경옥채/e_scm_kyo`) | 2분 |
| 3 | Vercel | 고객사 이메일로 가입, GitHub 연동 | 5분 |
| 4 | Supabase | 고객사 이메일로 가입, 새 프로젝트 생성 | 5분 |

### 3-2. 소스코드 이전

```bash
# 개발자 PC에서 실행

# 1) 고객사 레포를 remote로 추가
git remote add client https://github.com/경옥채/e_scm_kyo.git

# 2) 고객사 레포에 push
git push client master

# 3) 고객사 GitHub → Settings → Collaborators → 개발자 계정 초대 (Write 권한)
# 4) 개발자가 초대 수락
```

### 3-3. Vercel 배포

```
1. 고객사 Vercel 대시보드 → New Project
2. Import Git Repository → 고객사 GitHub 레포 선택
3. Framework Preset: Next.js (자동 감지)
4. Environment Variables 설정 (아래 3-5 참조)
5. Deploy 클릭
6. 배포 완료 후 URL 확인
```

### 3-4. DB 이전 (Supabase)

#### 방법 A: 마이그레이션 순차 실행 (클린 설치, 추천)
```
고객사 Supabase → SQL Editor에서 순서대로 실행:

1. supabase/schema.sql             (기본 스키마)
2. supabase/kakao_schema.sql       (알림톡 스키마)
3. supabase/migrations/001 ~ 032   (마이그레이션 32개 순서대로)
```

#### 방법 B: 데이터 포함 전체 덤프 (기존 데이터 이관)
```bash
# 기존 프로젝트에서 덤프
pg_dump -h db.기존.supabase.co -U postgres -d postgres \
  --no-owner --no-acl > backup.sql

# 고객사 프로젝트에 복원
psql -h db.고객사.supabase.co -U postgres -d postgres < backup.sql
```

### 3-5. 환경변수 설정

고객사 Vercel → Project Settings → Environment Variables:

```bash
# ── Supabase (고객사 프로젝트) ──
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJI...

# ── Cafe24 (기존 앱 정보 그대로) ──
CAFE24_MALL_ID=경옥채몰ID
CAFE24_CLIENT_ID=앱클라이언트ID
CAFE24_CLIENT_SECRET=앱시크릿
CAFE24_SHOP_NO=1
# 주의: CAFE24_REDIRECT_URI를 고객사 Vercel URL로 변경 필요
# 예: https://erp.경옥채.com/api/cafe24/callback

# ── Solapi (고객사 명의) ──
SOLAPI_API_KEY=NJ...
SOLAPI_API_SECRET=...
SOLAPI_SENDER_PHONE=02-xxxx-xxxx
SOLAPI_KAKAO_PFID=KA01PF...

# ── Claude AI ──
ANTHROPIC_API_KEY=sk-ant-...
# 또는 MiniMax
MINIMAX_API_KEY=...
MINIMAX_GROUP_ID=...

# ── 배치 보호 ──
CRON_SECRET=<openssl rand -hex 32 생성값>
```

### 3-6. Cafe24 재설정

Vercel URL이 바뀌므로 다음을 재설정:
```
1. 카페24 개발자센터 → 내 앱 → Redirect URI 변경
   기존: https://e-scm-kyo.vercel.app/api/cafe24/callback
   변경: https://고객사도메인/api/cafe24/callback

2. Webhook URL 변경 (등록된 경우)
   기존: https://e-scm-kyo.vercel.app/api/webhooks/cafe24
   변경: https://고객사도메인/api/webhooks/cafe24

3. 재인증: 브라우저에서 https://고객사도메인/api/cafe24/auth 접속
```

### 3-7. GitHub Actions 설정 (배치 크론)

고객사 GitHub 레포 → Settings → Secrets and variables → Actions:
```
APP_URL     = https://고객사도메인 (또는 xxx.vercel.app)
CRON_SECRET = <Vercel 환경변수와 동일한 값>
```

### 3-8. 커스텀 도메인 (선택)

```
1. 고객사 Vercel → Project → Settings → Domains
2. 도메인 추가: erp.경옥채.com
3. DNS 설정: CNAME erp → cname.vercel-dns.com
4. HTTPS 자동 발급 (Vercel이 처리)
```

---

## 4. 이전 후 개발·배포 흐름

### 일상 개발 (개발자)
```bash
# 코드 수정 후
git add -A && git commit -m "fix: 버그 수정"

# 양쪽에 push
git push origin master   # 개발자 레포 (백업)
git push client master   # 고객사 레포 → Vercel 자동 배포
```

### 또는 remote를 하나로 통합
```bash
# 고객사 레포만 사용하는 경우
git remote set-url origin https://github.com/경옥채/e_scm_kyo.git
git push  # → 고객사 Vercel 자동 배포
```

### 긴급 수정
```bash
git push client master   # push 즉시 Vercel 자동 빌드+배포 (약 2분)
```

---

## 5. 파트너십 해지 시 처리

### 개발자 측
- 고객사 GitHub Collaborator에서 제거됨 → push 불가
- 개발자 본인 레포(origin)에 소스 백업 보유
- 다른 고객에게 동일 코드베이스 재활용 가능

### 고객사 측
- GitHub 레포 + Vercel + Supabase 모두 본인 명의 → 계속 운영 가능
- 단, 유지보수(버그 수정, 기능 추가)는 직접 하거나 새 개발자 필요
- 소스코드는 레포에 있으므로 새 개발자가 이어받을 수 있음

### 소스코드 양도 (옵션)
- 파트너십 견적서(QT-002) 기준 **5,000만원**에 완전 양도
- 양도 시 개발자는 해당 코드베이스 재사용 권리 포기

---

## 6. 운영 비용 구조

### 최소 (무료 중심)
| 서비스 | 비용 |
|---|---:|
| Vercel Hobby | 0원 (⚠️ 상업 사용 약관 위반) |
| Supabase Free | 0원 (GitHub Actions 크론으로 정지 방지) |
| Claude API | 사용량 (월 1~5만원) |
| Solapi | 건당 20~80원 |
| **월 고정비** | **약 0~5만원** |

### 권장 (안정 운영)
| 서비스 | 비용 |
|---|---:|
| Vercel Pro | $20/월 (약 27,000원) |
| Supabase Free | 0원 |
| Claude API | 사용량 (월 1~5만원) |
| Solapi | 건당 |
| **월 고정비** | **약 3~8만원** |

### 안정적 (성장 대비)
| 서비스 | 비용 |
|---|---:|
| Vercel Pro | $20/월 |
| Supabase Pro | $25/월 |
| Claude API | 사용량 |
| Solapi | 건당 |
| **월 고정비** | **약 6~12만원** |

---

## 7. Vercel Hobby 제한 사항

| 항목 | 제한 | 영향 |
|---|---|---|
| 상업 사용 | **금지** | 사업용 ERP는 위반 소지 → 계정 정지 리스크 |
| 함수 실행 시간 | 10초 | AI 에이전트·카페24 동기화·캠페인 발송 타임아웃 가능 |
| 크론잡 | 일 1회, 최대 2개 | GitHub Actions로 우회 가능 |
| 대역폭 | 100GB/월 | 10명 사용 시 충분 |
| 팀 기능 | 없음 | 1인 계정 |

→ **Vercel Pro($20/월) 전환 시 모든 제한 해소**

---

## 8. Supabase Free 주의사항

| 항목 | 제한 | 대응 |
|---|---|---|
| DB 용량 | 500MB | 2~3년 충분 (모니터링 필요) |
| 비활성 정지 | 7일 미접속 시 | GitHub Actions 크론이 매일 API 호출 → 방지 |
| 백업 | 자동 (7일 보관) | Pro는 30일 |
| 프로젝트 수 | 최대 2개 | 1개면 충분 |

---

## 9. 이전 체크리스트

### 사전 준비
- [ ] 고객사 GitHub 계정 생성
- [ ] 고객사 Vercel 계정 생성
- [ ] 고객사 Supabase 계정 생성
- [ ] 고객사 Solapi 계정 생성 + 발신프로필 등록
- [ ] 고객사 Anthropic(Claude) 계정 생성 + API 키 발급
- [ ] (선택) 커스텀 도메인 구입

### 이전 실행
- [ ] GitHub 레포 생성 + 소스 push
- [ ] Collaborator 초대·수락
- [ ] Vercel Import + 환경변수 설정
- [ ] Supabase 프로젝트 생성 + 마이그레이션 실행
- [ ] 초기 데이터 세팅 (지점, 사용자 계정, 제품 마스터)
- [ ] Cafe24 Redirect URI + Webhook URL 변경
- [ ] Cafe24 재인증 (/api/cafe24/auth)
- [ ] GitHub Actions Secrets 설정
- [ ] 배포 확인 + 로그인 테스트
- [ ] (선택) 커스텀 도메인 연결

### 이전 후 검증
- [ ] 전 화면 접속 확인 (20+ 화면)
- [ ] POS 결제 테스트
- [ ] 카페24 매출 동기화 테스트
- [ ] 알림톡 발송 테스트
- [ ] AI 에이전트 응답 테스트
- [ ] 고객 QR 가입 테스트
- [ ] 모바일 접근 테스트

---

*작성일: 2026-04-09*
*관련 문서: QUOTATION_PARTNERSHIP.md, AI_AGENT_STRATEGY.md*
