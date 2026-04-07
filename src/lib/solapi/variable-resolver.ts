/**
 * 알림톡 템플릿 변수 자동 해석기
 * 변수명 패턴으로 의미를 파악하여 시스템 데이터를 자동 주입합니다.
 */

export interface VariableContext {
  customerName?: string;
  customerPhone?: string;
  customerGrade?: string;
  customerId?: string;
  orderNo?: string;
  trackingNo?: string;
  amount?: string;
  productName?: string;
  branchName?: string;
  authCode?: string;       // 인증번호 (필요 시 생성 후 전달)
}

const NAME_PATTERNS    = /^[가-힣]{2,3}$|^(고객명|이름|성함|회원명)$/;
const PHONE_PATTERNS   = /^(전화번호|연락처|핸드폰|휴대폰|휴대전화)$/;
const URL_PATTERNS     = /^(url|URL|링크|사이트|홈페이지|주소)$/i;
const ORDER_PATTERNS   = /^(주문번호|주문_번호|오더번호)$/;
const TRACKING_PATTERNS = /^(송장번호|운송장번호|배송번호|운송번호)$/;
const AMOUNT_PATTERNS  = /^(금액|결제금액|주문금액|가격|amount)$/i;
const PRODUCT_PATTERNS = /^(상품명|제품명|품목|상품)$/;
const GRADE_PATTERNS   = /^(등급|회원등급|고객등급)$/;
const AUTH_PATTERNS    = /^(인증번호|인증코드|otp|OTP)$/;

export function resolveVariable(key: string, ctx: VariableContext): string {
  // key 형식: #{변수명} → 변수명 추출
  const inner = key.replace(/^#\{/, '').replace(/\}$/, '').trim();

  if (NAME_PATTERNS.test(inner))     return ctx.customerName  ?? key;
  if (PHONE_PATTERNS.test(inner))    return ctx.customerPhone ?? key;
  if (GRADE_PATTERNS.test(inner))    return ctx.customerGrade ?? key;
  if (ORDER_PATTERNS.test(inner))    return ctx.orderNo       ?? key;
  if (TRACKING_PATTERNS.test(inner)) return ctx.trackingNo    ?? key;
  if (AMOUNT_PATTERNS.test(inner))   return ctx.amount        ?? key;
  if (PRODUCT_PATTERNS.test(inner))  return ctx.productName   ?? key;
  if (AUTH_PATTERNS.test(inner))     return ctx.authCode      ?? key;

  if (URL_PATTERNS.test(inner)) {
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL?.split('/rest')[0] ?? '';
    return base;
  }

  // 해석 불가 → 원래 플레이스홀더 유지
  return key;
}

export function resolveAllVariables(
  variableKeys: string[],
  ctx: VariableContext,
): Record<string, string> {
  return Object.fromEntries(
    variableKeys.map(key => [key, resolveVariable(key, ctx)])
  );
}
