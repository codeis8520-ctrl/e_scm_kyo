import crypto from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Cafe24WebhookEvent, CAFE24_STATUS_TO_LOCAL } from './types';
import { Cafe24Client, generateCafe24OrderCode } from './client';
import { createSaleJournal } from '@/lib/accounting-actions';

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

  const orderResponse = await client.getOrder(orderNo);

  if (!orderResponse.success || !orderResponse.data) {
    await logSyncEvent('order_fetch_error', orderNo.toString(), event, 'failed', 'Failed to fetch order from Cafe24');
    return { success: false, message: 'Failed to fetch order from Cafe24' };
  }

  const cafe24Order = orderResponse.data;
  const orderCode = generateCafe24OrderCode(process.env.CAFE24_MALL_ID || '', orderNo);

  let customerId: string | null = null;
  if (memberId) {
    const { data: customer } = await getSupabase()
      .from('customers')
      .select('id')
      .eq('cafe24_member_id', memberId)
      .single();
    
    if (customer) {
      customerId = customer.id;
    } else {
      // 자동 고객 생성
      const customerName = cafe24Order.orderer_name || `고객_${memberId}`;
      const customerPhone = cafe24Order.orderer_cellphone || cafe24Order.orderer_phone || '';
      
      const { data: newCustomer } = await getSupabase()
        .from('customers')
        .insert({
          name: customerName,
          phone: customerPhone || `cafe24_${memberId}`,
          cafe24_member_id: memberId,
          grade: 'NORMAL',
          email: cafe24Order.orderer_email || null,
          address: cafe24Order.recipient_address || null,
        })
        .select('id')
        .single();
      
      customerId = newCustomer?.id || null;
      await logSyncEvent('customer_auto_created', memberId.toString(), { member_id: memberId, name: customerName }, 'success');
    }
  }

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

  const { data: newOrder, error: orderError } = await getSupabase()
    .from('sales_orders')
    .insert({
      order_number: orderCode,
      channel: 'ONLINE',
      branch_id: branchId,
      customer_id: customerId,
      ordered_by: orderedById,
      total_amount: cafe24Order.total_order_price,
      discount_amount: cafe24Order.total_discount_price,
      status: 'PENDING',
      payment_method: mapPaymentMethod(cafe24Order.payment_method),
      cafe24_order_id: orderNo.toString(),
      memo: `Delivery: ${cafe24Order.recipient_address}`,
      ordered_at: new Date(cafe24Order.order_date).toISOString(),
    })
    .select()
    .single();

  if (orderError) {
    await logSyncEvent('order_creation_error', orderNo.toString(), cafe24Order, 'failed', orderError.message);
    return { success: false, message: orderError.message };
  }

  await logSyncEvent('order_created', orderNo.toString(), cafe24Order, 'success');

  return { success: true, message: 'Order created successfully', orderId: newOrder.id };
}

async function handleOrderPaid(
  orderCode: string,
  statusCode: string
): Promise<{ success: boolean; message: string; orderId?: string }> {
  const localStatus = CAFE24_STATUS_TO_LOCAL[statusCode] || 'CONFIRMED';

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
    .update({ status: localStatus })
    .eq('id', order.id);

  if (error) {
    await logSyncEvent('order_status_update', orderCode, { status: localStatus }, 'failed', error.message);
    return { success: false, message: error.message };
  }

  await logSyncEvent('order_paid', orderCode, { status: localStatus }, 'success');
  return { success: true, message: 'Order paid status updated', orderId: order.id };
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

  // 상태를 COMPLETED(구매확정=매출확정)로 업데이트
  const { error: updateError } = await getSupabase()
    .from('sales_orders')
    .update({
      status: 'COMPLETED',
      purchase_confirmed_at: now,
    })
    .eq('id', order.id);

  if (updateError) {
    await logSyncEvent('order_confirmed_error', orderCode, event, 'failed', updateError.message);
    return { success: false, message: updateError.message };
  }

  // 매출 분개 생성 (구매확정 시점에 수익 인식)
  try {
    await createSaleJournal({
      orderId: order.id,
      orderNumber: order.order_number,
      orderDate: now.slice(0, 10),
      totalAmount: Number(order.total_amount),
      paymentMethod: order.payment_method ?? 'card',
      cogs: 0, // 원가는 별도 계산 필요 시 추가
    });
  } catch (journalErr) {
    // 분개 실패는 경고만 — 주문 상태 업데이트는 이미 완료
    await logSyncEvent('order_confirmed_journal_warn', orderCode, { journalErr }, 'success', '분개 생성 실패(무시됨)');
  }

  await logSyncEvent('order_confirmed', orderCode, { purchase_confirmed_at: now }, 'success');
  return { success: true, message: 'Order purchase confirmed, revenue recognized', orderId: order.id };
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
        orderDate: new Date().toISOString().slice(0, 10),
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

function mapPaymentMethod(cafe24Method: string): string {
  const methodMap: Record<string, string> = {
    'card': 'card',
    'kakao': 'kakao',
    'naver': 'card',
    'toss': 'card',
    'cash': 'cash',
  };
  return methodMap[cafe24Method.toLowerCase()] || 'card';
}
