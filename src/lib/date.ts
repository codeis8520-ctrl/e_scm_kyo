/**
 * KST (Asia/Seoul) 표시 레이어 포맷터
 *
 * 규칙:
 * - 모든 사용자 대상 UI 표시 날짜·시간은 이 유틸을 통해 포맷한다.
 * - DB 저장값(timestamptz), 외부 API payload(UTC ISO), 쿼리 경계 계산은 건드리지 않는다.
 * - null/undefined/Invalid Date → '-' 반환.
 * - 내부적으로 Intl.DateTimeFormat 인스턴스를 모듈 상수로 캐싱(매 호출마다 생성하지 않음).
 */
const KST = 'Asia/Seoul';
const LOCALE = 'ko-KR';

// 숫자 기반 2자리 패딩을 유지하기 위해 ko-KR 대신 sv-SE(ISO 유사) 로케일을 사용.
// ko-KR은 "2026. 04. 22." 형식을 내보내서 가독성이 떨어진다.
const ISO_LOCALE = 'sv-SE';

const dateFmt = new Intl.DateTimeFormat(ISO_LOCALE, {
  timeZone: KST,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const dateTimeFmt = new Intl.DateTimeFormat(ISO_LOCALE, {
  timeZone: KST,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dateTimeSecondsFmt = new Intl.DateTimeFormat(ISO_LOCALE, {
  timeZone: KST,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const timeFmt = new Intl.DateTimeFormat(ISO_LOCALE, {
  timeZone: KST,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const monthFmt = new Intl.DateTimeFormat(ISO_LOCALE, {
  timeZone: KST,
  year: 'numeric',
  month: '2-digit',
});

function toDate(input: string | Date | null | undefined): Date | null {
  if (input === null || input === undefined || input === '') return null;
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return null;
  return d;
}

/**
 * "YYYY-MM-DD HH:mm" (KST)
 */
export function fmtDateTimeKST(input: string | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return '-';
  // sv-SE는 "2026-04-22 14:30" 형태를 돌려주지만, 일부 런타임/로케일에서 쉼표가 들어갈 수 있어 방어적으로 정규화.
  return dateTimeFmt.format(d).replace(',', '').replace('T', ' ');
}

/**
 * "YYYY-MM-DD" (KST)
 */
export function fmtDateKST(input: string | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return '-';
  return dateFmt.format(d);
}

/**
 * "HH:mm" (KST)
 */
export function fmtTimeKST(input: string | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return '-';
  return timeFmt.format(d);
}

/**
 * "YYYY-MM" (KST)
 */
export function fmtMonthKST(input: string | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return '-';
  return monthFmt.format(d);
}

/**
 * "YYYY-MM-DD HH:mm:ss" (KST) — 로그/감사 용도
 */
export function fmtDateTimeKSTWithSeconds(input: string | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return '-';
  return dateTimeSecondsFmt.format(d).replace(',', '').replace('T', ' ');
}

/**
 * 한국어 자연어 날짜: "2026년 4월 22일 (수)" — 에이전트 컨텍스트 등 서술형 용도
 */
const koreanDayFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: KST,
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'short',
});

export function fmtKoreanDayKST(input: string | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return '-';
  return koreanDayFmt.format(d);
}

/**
 * 한국어 월 표기: "2026년 4월" — 월별 그룹 헤더 등 기존 한글 스타일 유지용
 */
const koreanMonthFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: KST,
  year: 'numeric',
  month: 'long',
});

export function fmtKoreanMonthKST(input: string | Date | null | undefined): string {
  const d = toDate(input);
  if (!d) return '-';
  return koreanMonthFmt.format(d);
}

/* ============================================================================
 * KST 쿼리 경계 유틸 (Phase B)
 *
 * 규칙:
 * - 모든 사용자 대면 "오늘/이번 달/최근 N일" 경계 계산은 이 유틸로 한다.
 * - KST(Asia/Seoul, UTC+9, DST 없음) 기준으로 해석 후 UTC ISO 문자열로 반환.
 * - DB `timestamptz`는 UTC로 저장되므로, 반환값은 UTC ISO이지만 실체는 KST 경계다.
 * - 세션/토큰 만료, 감사 로그, 경과 시간 계산, 외부 API payload에는 사용 금지.
 * ============================================================================ */

/**
 * 입력을 KST 기준 "YYYY-MM-DD" 문자열로 변환.
 * Date, ISO 문자열, 또는 "YYYY-MM-DD" 문자열을 수용.
 */
function toKstDateParts(
  input?: Date | string
): { year: number; month: number; day: number } {
  // 입력 없거나 Date 객체면 KST 달력 기준 yyyy-mm-dd 추출
  if (input === undefined || input === null) {
    return toKstDateParts(new Date());
  }
  // "YYYY-MM-DD" 단순 문자열이면 그대로 쓴다 (사용자 입력 date)
  if (typeof input === 'string') {
    const simple = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
    if (simple) {
      return { year: Number(simple[1]), month: Number(simple[2]), day: Number(simple[3]) };
    }
  }
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) {
    // 방어: 유효하지 않은 날짜면 현재 시점 KST로 폴백
    return toKstDateParts(new Date());
  }
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: KST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * KST 자정(00:00:00.000)의 UTC ISO.
 * 예: kstDayStart('2026-04-22') → "2026-04-21T15:00:00.000Z"
 * 예: kstDayStart() (KST 2026-04-22 08:00 기준) → "2026-04-21T15:00:00.000Z"
 */
export function kstDayStart(date?: Date | string): string {
  const { year, month, day } = toKstDateParts(date);
  return new Date(`${year}-${pad2(month)}-${pad2(day)}T00:00:00.000+09:00`).toISOString();
}

/**
 * KST 23:59:59.999의 UTC ISO.
 * 예: kstDayEnd('2026-04-22') → "2026-04-22T14:59:59.999Z"
 */
export function kstDayEnd(date?: Date | string): string {
  const { year, month, day } = toKstDateParts(date);
  return new Date(`${year}-${pad2(month)}-${pad2(day)}T23:59:59.999+09:00`).toISOString();
}

/**
 * 해당 월의 1일 KST 00:00의 UTC ISO.
 * 예: kstMonthStart('2026-04-22') → "2026-03-31T15:00:00.000Z"
 */
export function kstMonthStart(date?: Date | string): string {
  const { year, month } = toKstDateParts(date);
  return new Date(`${year}-${pad2(month)}-01T00:00:00.000+09:00`).toISOString();
}

/**
 * 해당 월 말일 KST 23:59:59.999의 UTC ISO.
 * 예: kstMonthEnd('2026-04-22') → "2026-04-30T14:59:59.999Z"
 */
export function kstMonthEnd(date?: Date | string): string {
  const { year, month } = toKstDateParts(date);
  // 다음 달 1일 KST 00:00 - 1ms 로 계산하여 월말 말일/시간 정확히 반영.
  const nextMonthYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextStart = new Date(
    `${nextMonthYear}-${pad2(nextMonth)}-01T00:00:00.000+09:00`
  );
  return new Date(nextStart.getTime() - 1).toISOString();
}

/**
 * 현재 KST 날짜 "YYYY-MM-DD".
 * 예: KST 2026-04-22 08:00 → "2026-04-22"
 */
export function kstTodayString(): string {
  const { year, month, day } = toKstDateParts(new Date());
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * KST 기준 "YYYY-MM".
 * 예: kstYearMonth('2026-04-22') → "2026-04"
 * 예: kstYearMonth() (KST 2026-04-22 기준) → "2026-04"
 */
export function kstYearMonth(date?: Date | string): string {
  const { year, month } = toKstDateParts(date);
  return `${year}-${pad2(month)}`;
}

/**
 * n일 전 KST 00:00의 UTC ISO. "최근 N일" 쿼리에 사용.
 * 예: 오늘이 KST 2026-04-22일 때 kstDaysAgoStart(7) → 2026-04-15 KST 00:00 = "2026-04-14T15:00:00.000Z"
 * 참고: 오늘 포함 7일을 원하면 n=6, 오늘 제외 과거 7일이면 n=7.
 */
export function kstDaysAgoStart(n: number): string {
  const { year, month, day } = toKstDateParts(new Date());
  // 안전하게 Date로 먼저 구성 후 n일 빼기 (KST 자정에서 UTC 로 변환된 시각에 N*86400000ms 빼면 KST 기준 N일 전 자정)
  const todayKstStartMs = new Date(
    `${year}-${pad2(month)}-${pad2(day)}T00:00:00.000+09:00`
  ).getTime();
  return new Date(todayKstStartMs - n * 86_400_000).toISOString();
}
