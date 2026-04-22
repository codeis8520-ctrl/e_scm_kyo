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
