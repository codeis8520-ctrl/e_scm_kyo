export const validators = {
  phone: (value: string): string | null => {
    if (!value) return null;
    const phoneRegex = /^01[016789]-?\d{3,4}-?\d{4}$/;
    if (!phoneRegex.test(value.replace(/-/g, ''))) {
      return '올바른 전화번호 형식이 아닙니다 (010-0000-0000)';
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
