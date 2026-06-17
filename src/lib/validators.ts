export const validators = {
  phone: (value: string): string | null => {
    if (!value) return null;
    // 휴대폰(010~019), 일반 유선(02, 031~064), 대표번호(15XX·16XX·18XX·070·080) 모두 허용
    // 하이픈·공백 제거 후 숫자 8~12자리 + 0/1로 시작 패턴
    const cleaned = value.replace(/[\s-]/g, '');
    if (!/^\d+$/.test(cleaned)) {
      return '전화번호에는 숫자, 하이픈, 공백만 입력할 수 있습니다';
    }
    if (!/^(0\d{7,10}|1\d{7,8})$/.test(cleaned)) {
      return '올바른 전화번호 형식이 아닙니다 (예: 02-3013-1075, 010-0000-0000, 1588-0000)';
    }
    return null;
  },

  email: (value: string | null): string | null => {
    if (!value) return null;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      return '올바른 이메일 형식이 아닙니다';
    }
    return null;
  },

  required: (value: string | null | undefined, fieldName: string): string | null => {
    if (!value || value.trim() === '') {
      return `${fieldName}은(는) 필수 입력 항목입니다`;
    }
    return null;
  },

  positiveNumber: (value: number | string, fieldName: string): string | null => {
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (isNaN(num) || num < 0) {
      return `${fieldName}은(는) 0 이상이어야 합니다`;
    }
    return null;
  },

  positiveInteger: (value: number | string, fieldName: string): string | null => {
    const num = typeof value === 'string' ? parseInt(value, 10) : value;
    if (isNaN(num) || num < 0 || !Number.isInteger(num)) {
      return `${fieldName}은(는) 0 이상의 정수여야 합니다`;
    }
    return null;
  },

  minLength: (value: string, min: number, fieldName: string): string | null => {
    if (value.length < min) {
      return `${fieldName}은(는) ${min}자 이상이어야 합니다`;
    }
    return null;
  },

  maxLength: (value: string, max: number, fieldName: string): string | null => {
    if (value.length > max) {
      return `${fieldName}은(는) ${max}자 이하여야 합니다`;
    }
    return null;
  },

  date: (value: string): string | null => {
    if (!value) return null;
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return '올바른 날짜 형식이 아닙니다';
    }
    return null;
  },

  code: (value: string): string | null => {
    if (!value) return null;
    const codeRegex = /^[A-Za-z0-9_-]+$/;
    if (!codeRegex.test(value)) {
      return '코드에는 영문, 숫자, 특수문자(-,_)만 사용 가능합니다';
    }
    return null;
  },

  url: (value: string | null): string | null => {
    if (!value) return null;
    try {
      new URL(value);
      return null;
    } catch {
      return '올바른 URL 형식이 아닙니다';
    }
  },
};

export function formatPhone(value: string): string {
  const numbers = value.replace(/[^\d]/g, '');
  if (numbers.length <= 3) return numbers;
  if (numbers.length <= 7) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`;
  return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`;
}

export function formatCurrency(value: string): string {
  const numbers = value.replace(/[^\d]/g, '');
  if (!numbers) return '';
  return parseInt(numbers, 10).toLocaleString('ko-KR');
}

export function parseCurrency(value: string): number {
  return parseInt(value.replace(/[^\d]/g, ''), 10) || 0;
}

// ── 재고 수량 공용 헬퍼 (#28 소수점 재고) ─────────────────────────────────────
//   Supabase 는 NUMERIC(14,4) 컬럼을 JS 문자열("30.0000")로 반환한다.
//   inventories.quantity / inventory_movements.quantity / safety_stock 을
//   읽어 산술·비교할 때 반드시 toNum() 으로 감싸 문자열 연결 회귀를 차단한다.
//   null/undefined/빈문자/NaN 은 모두 0 으로 정규화한다.
export function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// 재고 수량 표시: 저장 4자리 / 표시 2자리.
//   allowDecimal=true  → 소수 2자리 반올림 후 trailing-zero 제거 (0.9667→"0.97", 30→"30")
//   allowDecimal=false → 정수(반올림) + 천단위 구분 (기존 동작 유지)
export function fmtStock(v: unknown, allowDecimal?: boolean): string {
  const n = toNum(v);
  if (!allowDecimal) {
    return Math.round(n).toLocaleString('ko-KR');
  }
  // 소수 2자리로 반올림 → trailing-zero 제거. 정수면 정수로.
  const rounded = Math.round(n * 100) / 100;
  if (Number.isInteger(rounded)) return rounded.toLocaleString('ko-KR');
  return parseFloat(rounded.toFixed(2)).toString();
}

// 재고 입력 파싱: allowDecimal=true 면 parseFloat + 4자리 반올림, 아니면 정수.
//   빈문자/NaN 은 0. 음수는 호출부 정책에 맡긴다(여기선 부호 보존).
export function parseStockInput(value: string, allowDecimal?: boolean): number {
  if (value == null || value === '') return 0;
  if (!allowDecimal) {
    const i = parseInt(value, 10);
    return Number.isFinite(i) ? i : 0;
  }
  const f = parseFloat(value);
  if (!Number.isFinite(f)) return 0;
  // 저장 정밀도 4자리로 반올림
  return Math.round(f * 10000) / 10000;
}

export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
}

export function validateForm<T extends Record<string, any>>(
  data: T,
  rules: Partial<Record<keyof T, ((value: any) => string | null)>>
): ValidationResult {
  const errors: Record<string, string> = {};

  for (const [field, validator] of Object.entries(rules)) {
    if (validator) {
      const error = validator(data[field]);
      if (error) {
        errors[field] = error;
      }
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}
