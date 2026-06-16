import crypto from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Cafe24WebhookEvent, CAFE24_STATUS_TO_LOCAL, firstPositiveAmount, normalizeOptionValue, extractItemOptions } from './types';
import { Cafe24Client, generateCafe24OrderCode } from './client';
import { getValidAccessToken } from './token-store';
import { createSaleJournal } from '@/lib/accounting-actions';
import { fireNotificationTrigger } from '@/lib/notification-triggers';
import { kstTodayString } from '@/lib/date';

let supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!supabase) {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      throw new Error('Supabase environment variables not configured');
    }
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );
  }
  return supabase;
}

const CAFE24_SHOP_NO = process.env.CAFE24_SHOP_NO || '1';

export function verifyCafe24Webhook(
  payload: string,
  signature: string,
  clientSecret: string
): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', clientSecret)
    .update(payload)
    .digest('base64');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

export async function processCafe24Webhook(event: Cafe24WebhookEvent): Promise<{
  success: boolean;
  message: string;
  orderId?: string;
}> {
  const { event_type, order_no, member_id, status_code } = event;

  console.log(`Processing Cafe24 webhook: ${event_type}, order_no: ${order_no}, status: ${status_code}`);

  const orderCode = generateCafe24OrderCode(
    process.env.CAFE24_MALL_ID || '',
    order_no
  );

  try {
    switch (event_type) {
      case 'order.created':
        return await handleOrderCreated(order_no, member_id, event);
      case 'order.paid':
        return await handleOrderPaid(orderCode, status_code);
      case 'order.shipped':
        return await handleOrderShipped(orderCode, status_code, event);
      case 'order.delivered':
        return await handleOrderDelivered(orderCode, event);
      case 'order.confirmed':
        return await handleOrderConfirmed(orderCode, order_no, event);
      case 'order.cancelled':
        return await handleOrderCancelled(orderCode);
      case 'order.refunded':
        return await handleOrderRefunded(orderCode, event);
      default:
        return { success: true, message: `Event type ${event_type} not handled` };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await logSyncEvent('webhook_error', order_no.toString(), { event, error: errorMessage }, 'failed', errorMessage);
    return { success: false, message: errorMessage, orderId: orderCode };
  }
}

// 전화번호 정규화 — 숫자만 추출(레거시 임포트와 동일 규칙). 더미(0만)·미식별은 null.
function normalizePhoneDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = String(raw).replace(/\D/g, '');
  if (!d || /^0+$/.test(d)) return null;
  if (d.length === 10 || d.length === 11) return d;
  if (d.length > 11) return d.slice(0, 11);
  return null;
}

// 01012345678 → 010-1234-5678 (DB 저장 포맷 = 대시. 레거시·DIRECT 99.8%가 이 포맷이라
// ON CONFLICT(phone) dedup 이 정확히 맞도록 동일 포맷으로 변환)
function formatPhoneDashed(digits: string | null): string | null {
  if (!digits) return null;
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return digits;
}

// 자사몰 주문자 → ERP 고객 연결/생성 (레거시 중복 방지가 핵심).
//   1) cafe24_member_id 일치 → 연결
//   2) 전화(대시 포맷) 일치 → 기존 고객(레거시 포함) 연결 + member_id 백필
//   3) allowCreate(결제완료)면 신규 생성 — ON CONFLICT DO NOTHING 으로 기존 필드 절대 미수정
// 연결되면 sales_orders.customer_id 갱신. 반환: 최종 customer_id(없으면 null).
//
// 매칭 기준 = 이름 AND 전화. 전화만 같고 이름이 다르면(가족 공유번호 등) 연결하지 않고
// customer_id=null 유지(스냅샷으로 표시) — 엉뚱한 사람에게 매출 귀속 방지.
export async function linkOrCreateCustomer(params: {
  orderId: string | null;          // null이면 customer만 해석하고 주문 업데이트는 생략
  buyerName: string | null;
  buyerPhone: string | null;
  memberId: string | null;
  allowCreate: boolean;
}): Promise<string | null> {
  const sb = getSupabase();
  const { orderId, buyerName, buyerPhone, memberId, allowCreate } = params;
  const formatted = formatPhoneDashed(normalizePhoneDigits(buyerPhone));
  let customerId: string | null = null;

  // 1) member_id
  if (memberId) {
    const { data } = await sb.from('customers').select('id').eq('cafe24_member_id', memberId).maybeSingle();
    if (data) customerId = data.id;
  }
  // 2) 이름 AND 전화 일치 (기존/레거시 고객) — 찾으면 member_id 백필
  if (!customerId && formatted && buyerName) {
    const { data } = await sb.from('customers')
      .select('id, cafe24_member_id').eq('phone', formatted).eq('name', buyerName).maybeSingle();
    if (data) {
      customerId = data.id;
      if (memberId && !data.cafe24_member_id) {
        await sb.from('customers').update({ cafe24_member_id: memberId }).eq('id', data.id);
      }
    }
  }
  // 3) 신규 생성 (결제완료 + 이름·전화 모두 있을 때만). DO NOTHING → 기존 행 비파괴.
  //    재조회 후 name 까지 일치할 때만 채택 → 전화가 타인 소유면 연결 안 함(null 유지).
  if (!customerId && allowCreate && formatted && buyerName) {
    await sb.from('customers').upsert(
      { name: buyerName, phone: formatted, cafe24_member_id: memberId || null, source: 'CAFE24', is_active: true },
      { onConflict: 'phone', ignoreDuplicates: true }
    );
    const { data: created } = await sb.from('customers')
      .select('id, name, cafe24_member_id').eq('phone', formatted).maybeSingle();
    if (created && created.name === buyerName) {
      customerId = created.id;
      if (memberId && !created.cafe24_member_id) {
        await sb.from('customers').update({ cafe24_member_id: memberId }).eq('id', created.id);
      }
    }
  }

  if (customerId && orderId) {
    await sb.from('sales_orders').update({ customer_id: customerId }).eq('id', orderId);
  }
  return customerId;
}

// 카페24 주문 객체 → 주문자 스냅샷/결제여부 추출 (handleOrderCreated · 백필 공용).
export function extractBuyerInfo(cafe24Order: any): {
  buyerName: string | null;
  buyerPhone: string | null;
  memberId: string | null;
  isPaid: boolean;
} {
  const co = cafe24Order ?? {};
  const buyerObj = co.buyer ?? {};
  const recvObj = Array.isArray(co.receivers) ? (co.receivers[0] ?? {}) : {};
  const buyerName: string | null =
    (buyerObj.name ?? co.billing_name ?? co.orderer_name ?? recvObj.name ?? '').toString().trim() || null;
  const buyerPhone: string | null =
    (buyerObj.cellphone ?? buyerObj.phone ?? co.orderer_cellphone ?? co.orderer_phone ?? recvObj.cellphone ?? recvObj.phone ?? '').toString().trim() || null;
  const memberId: string | null = (co.member_id ?? '').toString().trim() || null;
  const isPaid =
    co.paid === 'T' || !!co.payment_date || ['F', 'M', 'A', 'B'].includes(String(co.order_status ?? ''));
  return { buyerName, buyerPhone, memberId, isPaid };
}

// 카페24 주문 객체 → 받는분(수령자) 스냅샷 추출. 원천 = receivers[0] (extractBuyerInfo와 동일 경로).
export function extractRecipientInfo(cafe24Order: any): {
  name: string | null;
  phone: string | null;
  zipcode: string | null;
  address: string | null;
  addressDetail: string | null;
} {
  const co = cafe24Order ?? {};
  const recvObj = Array.isArray(co.receivers) ? (co.receivers[0] ?? {}) : {};
  const clean = (v: unknown): string | null => (v ?? '').toString().trim() || null;
  return {
    name: clean(recvObj.name ?? recvObj.shipping_name),
    phone: clean(recvObj.cellphone ?? recvObj.phone),
    zipcode: clean(recvObj.zipcode),
    address: clean(recvObj.address1 ?? recvObj.address_full ?? recvObj.address),
    addressDetail: clean(recvObj.address2),
  };
}

// sales_order_items 생성 (품목) — webhook 신규주문 + backfill 공용.
// 멱등: 이미 품목이 있으면 skip. 매핑되면 product_id + 내부 product.name(item_text),
// 미매핑은 product_id=null + 원본 product_name. 재고 차감·movements·point_history 없음(범위 밖).
// 실패는 logSyncEvent('order_items_error')로 기록하되 throw하지 않음(호출부 성공 무회귀).
export async function syncCafe24OrderItems(
  salesOrderId: string,
  items: any[],
  orderNoForLog: string
): Promise<void> {
  try {
    if (items.length > 0) {
      // 멱등 가드: 이미 품목이 있으면 skip(수동 등록 registerCafe24Customers가 먼저 만든 경우 중복 방지).
      const { data: existingItems } = await getSupabase()
        .from('sales_order_items')
        .select('id')
        .eq('sales_order_id', salesOrderId)
        .limit(1);

      if (!existingItems?.length) {
        const mapKey = (code: string, optValue: string) => `${code}
${optValue}`;
        const productMap = new Map<string, string>();      // mapKey → product_id
        const productNameById = new Map<string, string>(); // product_id → name
        try {
          const wanted = new Set<string>();
          for (const i of items) {
            wanted.add(mapKey(String(i?.product_code ?? ''), normalizeOptionValue(i?.option_value)));
          }
          if (wanted.size > 0) {
            const db = getSupabase() as any;
            const { data: maps, error: mapErr } = await db
              .from('cafe24_product_map')
              .select('cafe24_product_code, option_value, product_id');
            if (!mapErr && Array.isArray(maps)) {
              for (const m of maps as any[]) {
                productMap.set(mapKey(String(m.cafe24_product_code ?? ''), String(m.option_value ?? '')), m.product_id);
              }
              const neededIds = [...new Set(
                [...wanted].map(k => productMap.get(k)).filter((v): v is string => !!v)
              )];
              if (neededIds.length > 0) {
                const { data: prods, error: prodErr } = await db
                  .from('products')
                  .select('id, name')
                  .in('id', neededIds);
                if (!prodErr && Array.isArray(prods)) {
                  for (const p of prods as any[]) productNameById.set(p.id, p.name);
                }
              }
            }
          }
        } catch {
          // 매핑 테이블 미적용/조회 실패 → 빈 Map 폴백(미매핑 degrade, 크래시 금지).
        }

        const rows = items.map((i) => {
          const pid = productMap.get(mapKey(String(i?.product_code ?? ''), normalizeOptionValue(i?.option_value)));
          const quantity = i.quantity || 1;
          const unitPrice = Number((i as any).price ?? (i as any).product_price ?? 0) || 0;
          return {
            sales_order_id: salesOrderId,
            product_id: pid ?? null,
            item_text: pid ? (productNameById.get(pid) ?? null) : (i.product_name ?? null),
            quantity,
            unit_price: unitPrice,
            total_price: unitPrice * quantity,
            order_option: extractItemOptions(i) || null,
            // delivery_type / receipt_status: 명시 안 함 → DB DEFAULT(PICKUP/RECEIVED, 마이그052).
          };
        });

        let { error: itemsError } = await getSupabase()
          .from('sales_order_items')
          .insert(rows);

        // 컬럼 미적용 방어(080/082 등): order_option/product_id 미존재 시 핵심 컬럼만으로 재시도.
        if (itemsError) {
          const code = String((itemsError as any).code || '');
          const msg = String(itemsError.message || '').toLowerCase();
          if (code === '42703' || (msg.includes('column') && msg.includes('does not exist'))) {
            const minimalRows = rows.map(({ order_option, product_id, ...rest }) => {
              void order_option; void product_id;
              return rest;
            });
            const retry = await getSupabase()
              .from('sales_order_items')
              .insert(minimalRows);
            itemsError = retry.error;
          }
        }

        if (itemsError) {
          await logSyncEvent('order_items_error', orderNoForLog, { salesOrderId, itemsError }, 'failed', itemsError.message);
        }
      }
    }
  } catch (e) {
    // 품목 생성 실패는 주문 생성 성공에 영향 주지 않음(080/082 미적용 등).
    await logSyncEvent('order_items_error', orderNoForLog, { salesOrderId }, 'failed', e instanceof Error ? e.message : 'unknown');
  }
}

async function handleOrderCreated(
  orderNo: number,
  memberId: string,
  event: Cafe24WebhookEvent
): Promise<{ success: boolean; message: string; orderId?: string }> {
  const client = new Cafe24Client(
    process.env.CAFE24_MALL_ID || '',
    process.env.CAFE24_CLIENT_ID || '',
    process.env.CAFE24_CLIENT_SECRET || ''
  );

  // DB에 저장된 access_token을 client에 주입 (없으면 NOT_AUTHENTICATED 실패)
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    await logSyncEvent('order_fetch_error', orderNo.toString(), event, 'failed', 'No valid Cafe24 access token');
    return { success: false, message: 'No valid Cafe24 access token — 토큰 갱신/재인증 필요' };
  }
  client.setTokens({
    access_token: accessToken,
    refresh_token: '',
    expires_at: Date.now() + 60 * 60 * 1000,
    token_type: 'Bearer',
  });

  const orderResponse = await client.getOrder(orderNo);

  if (!orderResponse.success || !orderResponse.data) {
    const errMsg = orderResponse.error
      ? `[${orderResponse.error.code}] ${orderResponse.error.message}`
      : 'Failed to fetch order from Cafe24 (no data)';
    await logSyncEvent('order_fetch_error', orderNo.toString(), { event, apiError: orderResponse.error }, 'failed', errMsg);
    return { success: false, message: errMsg };
  }

  const cafe24Order = orderResponse.data;
  const orderCode = generateCafe24OrderCode(process.env.CAFE24_MALL_ID || '', orderNo);

  // ──────────────────────────────────────────────────────────────────────
  // 주문자(orderer) 스냅샷 + 고객 dedup 연결/생성.
  //
  // [정책 — 2026-06 변경]
  //   자사몰에서 실제 결제한 주문자는 거래기록이므로 ERP 고객으로 등록/연결한다.
  //   - 주문자 이름/전화는 항상 sales_orders 스냅샷(buyer_name/buyer_phone)에 보존
  //     → 판매현황에서 customer_id 없어도 "비회원" 대신 이름/전화 표시.
  //   - 고객 연결/생성은 linkOrCreateCustomer 가 결제완료(paid) 시점에 수행
  //     (member_id → phone dedup → 신규). 레거시 임포트 고객과 중복되지 않도록
  //     전화 대시포맷 ON CONFLICT(phone) 로 매칭, 기존 행은 절대 수정/덮어쓰지 않음.
  //   - 미결제/이름·전화 없는 게스트 주문은 customer_id=null 유지(스냅샷만).
  // ──────────────────────────────────────────────────────────────────────
  const { buyerName, buyerPhone } = extractBuyerInfo(cafe24Order);
  const recipient = extractRecipientInfo(cafe24Order);

  const { data: existingOrder } = await getSupabase()
    .from('sales_orders')
    .select('id')
    .eq('cafe24_order_id', orderNo.toString())
    .single();

  if (existingOrder) {
    await logSyncEvent('order_duplicate', orderNo.toString(), cafe24Order, 'success', 'Order already exists');
    return { success: true, message: 'Order already exists', orderId: existingOrder.id };
  }

  const onlineBranchQuery = await getSupabase()
    .from('branches')
    .select('id')
    .eq('channel', 'ONLINE')
    .limit(1);

  const branchId = onlineBranchQuery.data?.[0]?.id;

  if (!branchId) {
    await logSyncEvent('order_creation_error', orderNo.toString(), cafe24Order, 'failed', 'No ONLINE branch found');
    return { success: false, message: 'No ONLINE branch configured' };
  }

  const { data: adminUser } = await getSupabase()
    .from('users')
    .select('id')
    .eq('role', 'SUPER_ADMIN')
    .limit(1);

  const orderedById = adminUser?.[0]?.id;

  const insertPayload: Record<string, unknown> = {
    order_number: orderCode,
    channel: 'ONLINE',
    branch_id: branchId,
    customer_id: null,                // linkOrCreateCustomer 가 결제완료 시점에 채움
    buyer_name: buyerName,            // 주문자 스냅샷 — 비회원 표시 방지
    buyer_phone: buyerPhone,
    recipient_name: recipient.name,           // 받는분 스냅샷 — shipment 없어도 표시 (마이그 083)
    recipient_phone: recipient.phone,
    recipient_zipcode: recipient.zipcode,
    recipient_address: recipient.address,
    recipient_address_detail: recipient.addressDetail,
    ordered_by: orderedById,
    total_amount: firstPositiveAmount(
      (cafe24Order as any).payment_amount,
      (cafe24Order as any).order_price_amount,
      (cafe24Order as any).total_order_price,
      (cafe24Order as any).actual_payment_amount,
    ),
    discount_amount:
      Number(
        (cafe24Order as any).total_discount_price ??
        (cafe24Order as any).order_discount_amount ??
        0
      ) || 0,
    status: 'PENDING',
    payment_method: mapPaymentMethod(cafe24Order.payment_method),
    cafe24_order_id: orderNo.toString(),
    // 받는분 주소 = recipient.address(+상세). 임베드 응답엔 평면 recipient_address가 없어
    // 항상 undefined였음 → extractRecipientInfo로 추출한 값 사용. 주소 없으면 null('undefined' 금지).
    memo: recipient.address
      ? `Delivery: ${[recipient.address, recipient.addressDetail].filter(Boolean).join(' ')}`
      : null,
    ordered_at: new Date(cafe24Order.order_date).toISOString(),
  };

  let { data: newOrder, error: orderError } = await getSupabase()
    .from('sales_orders')
    .insert(insertPayload)
    .select()
    .single();

  // 마이그 083 미적용 방어: recipient_* 컬럼이 없으면(42703) 해당 5필드 제거 후 재시도.
  if (orderError) {
    const code = String((orderError as any).code || '');
    const msg = String(orderError.message || '').toLowerCase();
    if (code === '42703' || msg.includes('recipient_') || (msg.includes('column') && msg.includes('does not exist'))) {
      const {
        recipient_name, recipient_phone, recipient_zipcode, recipient_address, recipient_address_detail,
        ...payloadWithoutRecipient
      } = insertPayload;
      void recipient_name; void recipient_phone; void recipient_zipcode; void recipient_address; void recipient_address_detail;
      const retry = await getSupabase()
        .from('sales_orders')
        .insert(payloadWithoutRecipient)
        .select()
        .single();
      newOrder = retry.data; orderError = retry.error;
    }
  }

  if (orderError) {
    await logSyncEvent('order_creation_error', orderNo.toString(), cafe24Order, 'failed', orderError.message);
    return { success: false, message: orderError.message };
  }

  await logSyncEvent('order_created', orderNo.toString(), cafe24Order, 'success');

  // ── sales_order_items 생성 (품목) — webhook·backfill 공용 함수로 위임 ──────────
  // 매핑되면 product_id + 내부 product.name(item_text), 미매핑은 product_id=null + 원본 product_name.
  // 재고 차감·movements·point_history 없음(범위 밖). 품목 실패가 주문 생성 성공을 깨지 않음(내부 try/catch).
  await syncCafe24OrderItems(newOrder.id, cafe24Order.items ?? [], orderNo.toString());

  // 주문자 → 기존 고객 자동 "연결"만 (자동 생성 안 함 — 미등록은 배송탭에서 수동 등록).
  await linkOrCreateCustomer({
    orderId: newOrder.id,
    buyerName,
    buyerPhone,
    memberId: memberId || null,
    allowCreate: false,
  });

  return { success: true, message: 'Order created successfully', orderId: newOrder.id };
}

async function handleOrderPaid(
  orderCode: string,
  _statusCode: string
): Promise<{ success: boolean; message: string; orderId?: string }> {
  const now = new Date().toISOString();

  const { data: order } = await getSupabase()
    .from('sales_orders')
    .select('id, order_number, total_amount, payment_method, ordered_at')
    .eq('order_number', orderCode)
    .maybeSingle();

  if (!order) {
    return { success: false, message: 'Order not found' };
  }

  // 결제 즉시 매출 인식 — COMPLETED로 바로 전환
  const { error } = await getSupabase()
    .from('sales_orders')
    .update({ status: 'COMPLETED', purchase_confirmed_at: now })
    .eq('id', order.id);

  if (error) {
    await logSyncEvent('order_paid_error', orderCode, { status: 'COMPLETED' }, 'failed', error.message);
    return { success: false, message: error.message };
  }

  // 결제완료 시점 — 아직 미연결(웹훅 order.created가 미결제로 먼저 온 경우)이면
  // 저장된 주문자 스냅샷으로 고객 연결/생성 (자사몰만).
  try {
    const { data: full } = await getSupabase()
      .from('sales_orders')
      .select('id, customer_id, channel, buyer_name, buyer_phone')
      .eq('id', order.id)
      .maybeSingle();
    if (full && !full.customer_id && full.channel === 'ONLINE') {
      await linkOrCreateCustomer({
        orderId: full.id,
        buyerName: full.buyer_name,
        buyerPhone: full.buyer_phone,
        memberId: null,
        allowCreate: false,   // 자동 생성 안 함 — 기존 고객 연결만
      });
    }
  } catch {
    /* 고객 연결 실패가 매출 인식을 막지 않음 */
  }

  // 매출 분개 생성 (결제 시점 수익 인식)
  try {
    await createSaleJournal({
      orderId: order.id,
      orderNumber: order.order_number,
      orderDate: now.slice(0, 10),
      totalAmount: Number(order.total_amount),
      paymentMethod: order.payment_method ?? 'card',
      cogs: 0,
    });
  } catch (journalErr) {
    await logSyncEvent('order_paid_journal_warn', orderCode, { journalErr }, 'success', '분개 생성 실패(무시됨)');
  }

  // 주문 완료 알림톡 자동 발송 (매핑 등록된 경우만)
  try {
    const { data: custRow } = await getSupabase()
      .from('sales_orders')
      .select('customer:customers(id, name, phone, grade)')
      .eq('id', order.id)
      .maybeSingle();
    const cust = (custRow as any)?.customer;
    if (cust?.name && cust?.phone) {
      fireNotificationTrigger({
        eventType: 'ORDER_COMPLETE',
        customer: { id: cust.id, name: cust.name, phone: cust.phone },
        context: {
          orderNo: order.order_number,
          amount: Number(order.total_amount),
          customerGrade: cust.grade || 'NORMAL',
        },
      }).catch(() => {});
    }
  } catch {
    /* 알림톡 실패가 업무 흐름을 막지 않음 */
  }

  await logSyncEvent('order_paid', orderCode, { status: 'COMPLETED', purchase_confirmed_at: now }, 'success');
  return { success: true, message: 'Order paid — revenue recognized immediately', orderId: order.id };
}

async function handleOrderShipped(
  orderCode: string,
  statusCode: string,
  event: Cafe24WebhookEvent
): Promise<{ success: boolean; message: string; orderId?: string }> {
  const localStatus = CAFE24_STATUS_TO_LOCAL[statusCode] || 'SHIPPED';
  const orderNoStr = event.order_no?.toString() ?? '';

  // sales_orders 업데이트
  const { data: order } = await getSupabase()
    .from('sales_orders')
    .select('id')
    .eq('order_number', orderCode)
    .maybeSingle();

  if (order) {
    await getSupabase()
      .from('sales_orders')
      .update({ status: localStatus })
      .eq('id', order.id);
  }

  // shipments 업데이트 (카페24에서 배송처리한 경우)
  if (orderNoStr) {
    await getSupabase()
      .from('shipments')
      .update({
        status: 'SHIPPED',
        tracking_number: event.tracking_no ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('cafe24_order_id', orderNoStr);
  }

  await logSyncEvent('order_shipped', orderCode, { status: localStatus, tracking: event.tracking_no }, 'success');
  return { success: true, message: 'Order shipped status updated', orderId: order?.id };
}

async function handleOrderDelivered(
  orderCode: string,
  event?: Cafe24WebhookEvent
): Promise<{ success: boolean; message: string; orderId?: string }> {
  const orderNoStr = event?.order_no?.toString() ?? '';

  // sales_orders 업데이트
  const { data: order } = await getSupabase()
    .from('sales_orders')
    .select('id')
    .eq('order_number', orderCode)
    .maybeSingle();

  if (order) {
    await getSupabase()
      .from('sales_orders')
      .update({ status: 'DELIVERED' })
      .eq('id', order.id);
  }

  // shipments 업데이트
  if (orderNoStr) {
    await getSupabase()
      .from('shipments')
      .update({
        status: 'DELIVERED',
        updated_at: new Date().toISOString(),
      })
      .eq('cafe24_order_id', orderNoStr);
  }

  await logSyncEvent('order_delivered', orderCode, null, 'success');
  return { success: true, message: 'Order delivered', orderId: order?.id };
}

async function handleOrderConfirmed(
  orderCode: string,
  orderNo: number,
  event: Cafe24WebhookEvent
): Promise<{ success: boolean; message: string; orderId?: string }> {
  const now = new Date().toISOString();

  // sales_orders 조회
  const { data: order } = await getSupabase()
    .from('sales_orders')
    .select('id, order_number, total_amount, payment_method, ordered_at')
    .eq('order_number', orderCode)
    .maybeSingle();

  if (!order) {
    await logSyncEvent('order_confirmed_not_found', orderCode, event, 'failed', 'Order not found in DB');
    return { success: false, message: 'Order not found' };
  }

  // 이미 order.paid에서 COMPLETED + 분개 처리됨 — purchase_confirmed_at만 기록
  const { error: updateError } = await getSupabase()
    .from('sales_orders')
    .update({ purchase_confirmed_at: now })
    .eq('id', order.id);

  if (updateError) {
    await logSyncEvent('order_confirmed_error', orderCode, event, 'failed', updateError.message);
    return { success: false, message: updateError.message };
  }

  await logSyncEvent('order_confirmed', orderCode, { purchase_confirmed_at: now }, 'success');
  return { success: true, message: 'Order confirmed (revenue already recognized at payment)', orderId: order.id };
}

async function handleOrderCancelled(
  orderCode: string
): Promise<{ success: boolean; message: string; orderId?: string }> {
  const { data: order } = await getSupabase()
    .from('sales_orders')
    .select('id')
    .eq('order_number', orderCode)
    .single();

  if (!order) {
    return { success: false, message: 'Order not found' };
  }

  const { error } = await getSupabase()
    .from('sales_orders')
    .update({ status: 'CANCELLED' })
    .eq('id', order.id);

  if (error) {
    await logSyncEvent('order_cancelled_error', orderCode, null, 'failed', error.message);
    return { success: false, message: error.message };
  }

  await logSyncEvent('order_cancelled', orderCode, null, 'success');
  return { success: true, message: 'Order cancelled', orderId: order.id };
}

async function handleOrderRefunded(
  orderCode: string,
  event?: Cafe24WebhookEvent
): Promise<{ success: boolean; message: string; orderId?: string }> {
  // 카페24의 refund_price 정보가 있으면 부분환불, 없으면 전체환불
  const refundAmount = (event as any)?.refund_price ? Number((event as any).refund_price) : null;

  const { data: order } = await getSupabase()
    .from('sales_orders')
    .select('id, order_number, total_amount, payment_method, status, ordered_at')
    .eq('order_number', orderCode)
    .maybeSingle();

  if (!order) {
    return { success: false, message: 'Order not found' };
  }

  const isPartial = refundAmount !== null && refundAmount < Number(order.total_amount);
  const newStatus = isPartial ? 'PARTIALLY_REFUNDED' : 'REFUNDED';
  const actualRefundAmount = refundAmount ?? Number(order.total_amount);

  const { error } = await getSupabase()
    .from('sales_orders')
    .update({
      status: newStatus,
      refund_amount: actualRefundAmount,
    })
    .eq('id', order.id);

  if (error) {
    await logSyncEvent('order_refunded_error', orderCode, event ?? null, 'failed', error.message);
    return { success: false, message: error.message };
  }

  // 구매확정(COMPLETED) 상태였다면 역분개 생성
  if (order.status === 'COMPLETED') {
    try {
      // 매출 역분개: 미수금 대변, 매출 차변 (반대 방향)
      await createSaleJournal({
        orderId: order.id,
        orderNumber: `REFUND-${order.order_number}`,
        orderDate: kstTodayString(),
        totalAmount: -actualRefundAmount, // 음수로 역분개
        paymentMethod: order.payment_method ?? 'card',
        cogs: 0,
      });
    } catch {
      // 역분개 실패는 경고만
    }
  }

  await logSyncEvent('order_refunded', orderCode, { newStatus, refundAmount: actualRefundAmount }, 'success');
  return { success: true, message: `Order ${newStatus}`, orderId: order.id };
}

async function logSyncEvent(
  syncType: string,
  cafe24OrderId: string,
  data: unknown,
  status: 'pending' | 'success' | 'failed',
  errorMessage?: string
) {
  await getSupabase().from('cafe24_sync_logs').insert({
    sync_type: syncType,
    cafe24_order_id: cafe24OrderId,
    data: data as object,
    status,
    error_message: errorMessage || null,
    processed_at: status !== 'pending' ? new Date().toISOString() : null,
  });
}

function mapPaymentMethod(cafe24Method: unknown): string {
  // 카페24는 payment_method를 string 또는 string[]로 반환할 수 있음
  let raw = '';
  if (Array.isArray(cafe24Method)) raw = String(cafe24Method[0] ?? '');
  else if (typeof cafe24Method === 'string') raw = cafe24Method;
  else if (cafe24Method && typeof cafe24Method === 'object') raw = String((cafe24Method as any).code ?? (cafe24Method as any).method ?? '');
  else raw = String(cafe24Method ?? '');

  const methodMap: Record<string, string> = {
    'card': 'card',
    'kakao': 'kakao',
    'naver': 'card',
    'toss': 'card',
    'cash': 'cash',
  };
  return methodMap[raw.toLowerCase()] || 'card';
}
