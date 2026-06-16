export interface Cafe24OrderItem {
  product_no: number;
  product_name: string;
  product_code: string;
  option_id: string;
  option_value: string;
  quantity: number;
  price: number;
  discount_amount: number;
  total_discount_amount: number;
}

export interface Cafe24Order {
  order_id: string;
  order_no: number;
  order_date: string;
  order_status: Cafe24OrderStatus;
  member_id: string;
  customer_id: string;
  orderer_name?: string;
  orderer_cellphone?: string;
  orderer_phone?: string;
  orderer_email?: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_address: string;
  delivery_message: string;
  items: Cafe24OrderItem[];
  total_product_price: number;
  total_discount_price: number;
  total_delivery_price: number;
  total_order_price: number;
  payment_method: string;
  payment_date: string;
  shipped_date: string | null;
  completed_date: string | null;
}

export interface Cafe24Member {
  member_id: string;
  member_name: string;
  member_email?: string;
  member_phone?: string;
  member_cellphone?: string;
  created_date: string;
}

export type Cafe24OrderStatus =
  | 'N'  // New order (not processed)
  | 'P'  // Preparing
  | 'S'  // Shipped
  | 'D'  // Delivered
  | 'C'; // Cancelled

export interface Cafe24WebhookEvent {
  event_type: Cafe24WebhookEventType;
  order_id: string;
  order_no: number;
  status_code: string;
  member_id: string;
  product_no: number;
  quantity: number;
  tracking_no: string | null;
  shipped_date: string | null;
  timestamp: number;
}

export type Cafe24WebhookEventType =
  | 'order.created'
  | 'order.paid'
  | 'order.shipped'
  | 'order.delivered'
  | 'order.confirmed'
  | 'order.cancelled'
  | 'order.refunded';

export interface Cafe24OAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type: string;
}

export interface Cafe24APIResponse<T> {
  success: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface Cafe24SyncResult {
  success: boolean;
  order_id: string;
  local_order_id?: string;
  error?: string;
}

export const CAFE24_ORDER_STATUS_MAP: Record<Cafe24OrderStatus, string> = {
  N: 'PENDING',
  P: 'CONFIRMED',
  S: 'SHIPPED',
  D: 'COMPLETED',
  C: 'CANCELLED',
};

export const CAFE24_STATUS_TO_LOCAL: Record<string, string> = {
  N: 'PENDING',       // 입금전
  F: 'CONFIRMED',     // 결제완료
  M: 'CONFIRMED',     // 배송준비중
  A: 'SHIPPED',       // 배송중
  B: 'DELIVERED',     // 배송완료 (구매확정 전)
  C: 'CANCELLED',     // 취소
  R: 'REFUNDED',      // 반품완료
  // 하위호환
  P: 'CONFIRMED',
  S: 'SHIPPED',
  D: 'DELIVERED',     // 구버전 D → DELIVERED (COMPLETED 아님)
};

// Cafe24 금액 필드는 문자열로 내려오고, 포인트 전액결제 시 payment_amount=0/"0".
// 우선순위대로 Number 변환 후 첫 번째 유한 + 양수 값을 반환(없으면 0).
export function firstPositiveAmount(...vals: unknown[]): number {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

// ─── 카페24 옵션조합 정규화 (매핑 키 단일 출처) ───────────────────────────────
// 카페24 item의 원본 option_value 문자열(예 "보자기포장=선택안함&쇼핑백=선택안함")을
// cafe24_product_map의 매칭 키로 변환한다. route.ts(조회)와 cafe24-actions.ts(저장)가
// 동일 모듈을 import해 써야 키가 byte 단위로 일치한다 — 불일치 시 매핑 영구 실패.
// 규칙(LOCKED): safeDecode → '&' split → '선택안함'/빈값 페어 제거 → key 사전순 정렬 → key=value join.
// 모든 옵션이 무선택이면 ''.
function safeDecodeKey(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}
function isNoSelectionValue(v: string): boolean {
  return v.replace(/\s+/g, '') === '선택안함';
}
export function normalizeOptionValue(raw: any): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw !== 'string') return '';
  const pairs: { key: string; value: string }[] = [];
  for (const token of raw.split('&')) {
    const eq = token.indexOf('=');
    let key: string;
    let value: string;
    if (eq < 0) {
      // eq 없으면 토큰 전체를 value로 취급(key 없음)
      key = '';
      value = safeDecodeKey(token).trim();
    } else {
      key = safeDecodeKey(token.slice(0, eq)).trim();
      value = safeDecodeKey(token.slice(eq + 1)).trim();
    }
    if (!value || isNoSelectionValue(value)) continue; // 무선택/빈값 페어 제거(키도 버림)
    pairs.push({ key, value });
  }
  pairs.sort((a, b) => a.key.localeCompare(b.key));
  return pairs.map(p => (p.key ? `${p.key}=${p.value}` : p.value)).join('&');
}
