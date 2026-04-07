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

// 이름 패턴: 순한글 2-3자(예:홍길동), 또는 이름 관련 키워드
const NAME_PATTERNS    = /^[가-힣]{2,3}$|^(고객명|이름|성함|회원명|구매자명|주문자명|수신자명|신청자명|고객이름|회원이름|받는분|구매자|주문자|수신자|고객)$/;
const PHONE_PATTERNS   = /^(전화번호|연락처|핸드폰|휴대폰|휴대전화)$/;
const URL_PATTERNS     = /^(url|URL|링크|사이트|홈페이지|주소)$/i;
const ORDER_PATTERNS   = /^(주문번호|주문_번호|오더번호)$/;
const TRACKING_PATTERNS = /^(송장번호|운송장번호|배송번호|운송번호)$/;
const AMOUNT_PATTERNS  = /^(금액|결제금액|주문금액|가격|amount)$/i;
const STORE_PATTERNS   = /^(상점명|상점|매장명|매장|브랜드명|브랜드|업체명|업체|회사명|회사|가게명|가게|샵명|샵)$/;
const PRODUCT_PATTERNS = /^(상품명|제품명|품목|상품)$/;
const GRADE_PATTERNS   = /^(등급|회원등급|고객등급)$/;
const AUTH_PATTERNS    = /^(인증번호|인증코드|otp|OTP)$/;

export function resolveVariable(key: string, ctx: VariableContext): string {
  // key 형식: #{변수명} → 변수명 추출
  const inner = key.replace(/^#\{/, '').replace(/\}$/, '').trim();

  // 구체적인 패턴 먼저 — 이름 패턴([가-힣]{2,3})이 상품명/상점명도 잡으므로 마지막에 검사
  if (STORE_PATTERNS.test(inner))    return ctx.branchName    || key;
  if (PRODUCT_PATTERNS.test(inner))  return ctx.productName   || key;
  if (ORDER_PATTERNS.test(inner))    return ctx.orderNo       || key;
  if (TRACKING_PATTERNS.test(inner)) return ctx.trackingNo    || key;
  if (AMOUNT_PATTERNS.test(inner))   return ctx.amount        || key;
  if (AUTH_PATTERNS.test(inner))     return ctx.authCode      || key;
  if (PHONE_PATTERNS.test(inner))    return ctx.customerPhone || key;
  if (GRADE_PATTERNS.test(inner))    return ctx.customerGrade || key;
  if (NAME_PATTERNS.test(inner))     return ctx.customerName  || key;

  if (URL_PATTERNS.test(inner)) {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || '';
    if (!siteUrl) return key;
    // 버튼 URL 템플릿이 "https://#{url}" 형식 — 프로토콜 제거 후 도메인/경로만 반환
    return siteUrl.replace(/^https?:\/\//, '');
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
