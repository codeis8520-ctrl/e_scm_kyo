# 알림톡 배치 실행 환경 설정 (무료 티어)

Vercel Hobby는 크론잡이 **일 1회·최대 2개**로 제한되어 실용적이지 않으므로,
**GitHub Actions 무료 크론 + 수동 실행 버튼** 조합으로 운영합니다.

---

## 1. GitHub Actions 스케줄 설정

### 1-1. Repository Secrets 등록
GitHub 저장소 → `Settings` → `Secrets and variables` → `Actions` → `New repository secret`

| 이름 | 값 | 설명 |
|---|---|---|
| `APP_URL` | `https://e-scm-kyo.vercel.app` | 배포된 Vercel URL |
| `CRON_SECRET` | 랜덤 문자열 32자 이상 | 배치 엔드포인트 보호 (Vercel 환경변수와 동일한 값) |

> **CRON_SECRET 생성 예시** (터미널):
> ```bash
> openssl rand -hex 32
> ```

### 1-2. Vercel 환경변수에도 동일하게 등록
Vercel 프로젝트 → Settings → Environment Variables:
- `CRON_SECRET = <위와 동일한 값>`

### 1-3. 워크플로 파일
`.github/workflows/notification-batches.yml` (이미 생성됨):
- **매일 09:00 KST** — 생일 축하 배치
- **매주 월요일 10:00 KST** — 휴면 재유치 배치
- **매일 02:00 KST** — 카페24 토큰 갱신

### 1-4. 동작 확인
- **자동 실행**: cron 시각이 되면 GitHub Actions가 자동으로 `$APP_URL/api/notifications/batch/...` 호출
- **수동 실행**: GitHub 저장소 → Actions 탭 → `Notification Batches` → `Run workflow` → 배치 선택
- **로그 확인**: 각 실행 로그에서 HTTP 응답 코드 및 배치 결과 확인

---

## 2. 수동 실행 버튼 (보조)

`/notifications` 페이지 헤더에 배치 실행 버튼 2개 제공:

| 버튼 | 동작 |
|---|---|
| 🎂 **생일 배치** | 오늘(MM-DD 매칭) 생일 고객에게 `BIRTHDAY` 이벤트 매핑 템플릿 즉시 발송 |
| 💤 **휴면 배치** | 최근 90일 미구매 활성 고객에게 `DORMANT` 템플릿 발송 (최대 50명, 최근 30일 재수신 제외) |

### 사용 사례
- GitHub Actions가 잠시 실패한 경우 수동 재실행
- 테스트 목적 (템플릿 검증)
- 임시 캠페인 (생일 외에도 특정일 수동 집행)
- HQ 권한 계정만 사용 가능 (SUPER_ADMIN / HQ_OPERATOR / EXECUTIVE)

---

## 3. 기타 무료 대안

### 3-1. cron-job.org (외부 서비스)
- 회원가입 후 URL 등록 → 설정 1분
- 단점: 외부 서비스 의존, 로그 분산, 한 곳에서 통합 관찰 어려움

### 3-2. Supabase pg_cron
```sql
-- Supabase Dashboard → Database → Extensions → pg_cron 활성화
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'birthday-batch',
  '0 0 * * *',  -- UTC 00:00 = KST 09:00
  $$
  SELECT net.http_get(
    url := 'https://e-scm-kyo.vercel.app/api/notifications/batch/birthday',
    headers := jsonb_build_object('Authorization', 'Bearer ${CRON_SECRET}')
  );
  $$
);
```
- 단점: pg_cron + pg_net 확장 활성화 필요, 에러 디버깅 어려움

### 3-3. 본인 PC의 Windows 작업 스케줄러 / 맥 launchd
- 운영 PC가 항상 켜져 있어야 동작
- 소규모 개인 운영 환경에서만 유효

---

## 4. 배치 로그 확인

### SQL 쿼리
```sql
SELECT
  batch_type,
  target_count,
  sent_count,
  failed_count,
  skipped_count,
  started_at,
  finished_at,
  detail
FROM notification_batch_logs
ORDER BY started_at DESC
LIMIT 20;
```

### GitHub Actions 로그
`Actions` 탭 → `Notification Batches` → 각 실행 클릭 → 단계별 로그 확인

---

## 5. 문제 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| GitHub Actions 401 | CRON_SECRET 불일치 | Vercel과 GitHub Secrets 값 동일한지 확인 |
| HTTP 200인데 sent=0 | 매핑 없음 | `/notifications/templates`에서 해당 이벤트에 `auto_trigger_enabled=true` 템플릿 지정 |
| sent > 0인데 고객 못 받음 | Solapi 발송 실패 | `notifications` 테이블의 `error_message` 컬럼 확인 |
| 미치환 변수 에러 | 이벤트 컨텍스트 부족 | `notification_template_mappings.variable_defaults`에 fallback 값 지정 |
| 배치 중복 실행 방지 | 휴면 배치 중복 걱정 | 자동으로 최근 30일 내 수신 고객은 제외됨 |

---

## 6. 요약

| 방법 | 설정 난이도 | 신뢰성 | 권장도 |
|---|---|---|---|
| **GitHub Actions** (주 운영) | ⭐⭐ (Secret 2개 등록) | ⭐⭐⭐⭐ | ★★★★★ |
| **수동 실행 버튼** (보조) | ⭐ (추가 설정 0) | ⭐⭐⭐ | ★★★★☆ |
| cron-job.org | ⭐⭐ | ⭐⭐⭐ | ★★★☆☆ |
| Supabase pg_cron | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ★★★☆☆ |
| Windows 작업 스케줄러 | ⭐⭐ | ⭐⭐ | ★★☆☆☆ |

**이 프로젝트는 GitHub Actions를 기본으로 채택**하며, 수동 실행 버튼은 비상용·테스트용으로 제공합니다.
