'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { requireSession, writeAuditLog } from '@/lib/session';
import { fireNotificationTrigger } from '@/lib/notification-triggers';

function getUserId(): string | null {
  try {
    const cookieStore = cookies();
    return (cookieStore as any).get('user_id')?.value || null;
  } catch {
    return null;
  }
}

export interface ReturnItem {
  sales_order_item_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
}

// ─── 환불 처리 (핵심 트랜잭션) ────────────────────────────────────────────────

export async function processRefund(params: {
  originalOrderId: string;
  branchId: string;
  reason: string;
  reasonDetail?: string;
  refundMethod: string;
  items: ReturnItem[];
}) {
  let session;
  try {
    session = await requireSession();
  } catch (e: any) {
    return { error: e.message };
  }

  const supabase = await createClient();
  const db = supabase as any;
  const userId = session.id;

  const { originalOrderId, branchId, reason, reasonDetail, refundMethod, items } = params;

  // 1. 원본 주문 조회
  const { data: originalOrder, error: orderErr } = await db
    .from('sales_orders')
    .select(`
      *,
      order_items:sales_order_items(*),
      branch:branches(code)
    `)
    .eq('id', originalOrderId)
    .single();

  if (orderErr || !originalOrder) {
    return { error: '원본 주문을 찾을 수 없습니다.' };
  }

  if (originalOrder.status === 'REFUNDED') {
    return { error: '이미 전액 환불된 주문입니다.' };
  }
  if (originalOrder.status === 'CANCELLED') {
    return { error: '취소된 주문은 환불할 수 없습니다.' };
  }

  // 2. 환불 항목 검증
  for (const item of items) {
    const origItem = originalOrder.order_items.find((oi: any) => oi.id === item.sales_order_item_id);
    if (!origItem) return { error: '원본 주문 항목을 찾을 수 없습니다.' };
    if (item.quantity > origItem.quantity) {
      return { error: `반품 수량(${item.quantity})이 구매 수량(${origItem.quantity})을 초과합니다.` };
    }
  }

  // 3. 환불 금액 계산
  const refundAmount = items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);

  // 4. 환불 번호 생성
  const branchCode = originalOrder.branch?.code || 'HQ';
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  const returnNumber = `RT-${branchCode}-${date}-${rand}`;

  let returnOrderId: string | null = null;

  try {
    // 5. 환불 전표 생성
    const { data: returnOrder, error: returnErr } = await db
      .from('return_orders')
      .insert({
        return_number: returnNumber,
        original_order_id: originalOrderId,
        branch_id: branchId,
        customer_id: originalOrder.customer_id || null,
        processed_by: userId,
        reason,
        reason_detail: reasonDetail || null,
        refund_amount: refundAmount,
        refund_method: refundMethod,
        status: 'COMPLETED',
        processed_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (returnErr) throw new Error(returnErr.message);
    returnOrderId = returnOrder.id;

    // 6. 환불 항목 저장
    await db.from('return_order_items').insert(
      items.map(i => ({
        return_order_id: returnOrderId,
        sales_order_item_id: i.sales_order_item_id,
        product_id: i.product_id,
        quantity: i.quantity,
        unit_price: i.unit_price,
        total_price: i.quantity * i.unit_price,
      }))
    );

    // 7. 재고 역복원
    for (const item of items) {
      const { data: inv } = await db
        .from('inventories')
        .select('id, quantity')
        .eq('branch_id', branchId)
        .eq('product_id', item.product_id)
        .maybeSingle();

      if (inv) {
        await db
          .from('inventories')
          .update({ quantity: inv.quantity + item.quantity })
          .eq('id', inv.id);
      } else {
        await db.from('inventories').insert({
          branch_id: branchId,
          product_id: item.product_id,
          quantity: item.quantity,
          safety_stock: 0,
        });
      }

      await db.from('inventory_movements').insert({
        branch_id: branchId,
        product_id: item.product_id,
        movement_type: 'IN',
        quantity: item.quantity,
        reference_id: returnOrderId,
        reference_type: 'RETURN',
        memo: `환불 입고 (${returnNumber})`,
      });
    }

    // 8. 포인트 처리 (원본 적립 포인트 차감)
    if (originalOrder.customer_id && originalOrder.points_earned > 0) {
      // 부분 환불 비율 계산
      const totalOriginal = originalOrder.order_items.reduce(
        (sum: number, oi: any) => sum + oi.total_price, 0
      );
      const refundRatio = totalOriginal > 0 ? refundAmount / totalOriginal : 0;
      const pointsToDeduct = Math.floor(originalOrder.points_earned * refundRatio);

      if (pointsToDeduct > 0) {
        const { data: lastHistory } = await db
          .from('point_history')
          .select('balance')
          .eq('customer_id', originalOrder.customer_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const currentBalance = lastHistory?.balance || 0;
        const newBalance = Math.max(0, currentBalance - pointsToDeduct);

        await db.from('point_history').insert({
          customer_id: originalOrder.customer_id,
          sales_order_id: originalOrderId,
          type: 'adjust',
          points: -pointsToDeduct,
          balance: newBalance,
          description: `환불 포인트 차감 (${returnNumber})`,
        });

        await db.from('return_orders')
          .update({ points_restored: -pointsToDeduct })
          .eq('id', returnOrderId);
      }
    }

    // 9. 원본 주문 상태 업데이트
    // 전체 항목 환불 여부 판단
    const totalReturnedQty = items.reduce((sum, i) => sum + i.quantity, 0);
    const totalOriginalQty = originalOrder.order_items.reduce(
      (sum: number, oi: any) => sum + oi.quantity, 0
    );
    const newStatus = totalReturnedQty >= totalOriginalQty ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

    await db.from('sales_orders')
      .update({ status: newStatus })
      .eq('id', originalOrderId);

    // 환불 완료 알림톡 자동 발송 (매핑 등록된 경우만)
    if (originalOrder.customer_id) {
      const { data: cust } = await db
        .from('customers')
        .select('id, name, phone, grade')
        .eq('id', originalOrder.customer_id)
        .maybeSingle();
      if (cust?.name && cust?.phone) {
        fireNotificationTrigger({
          eventType: 'REFUND',
          customer: { id: cust.id, name: cust.name, phone: cust.phone },
          context: {
            orderNo: originalOrder.order_number,
            amount: refundAmount,
            customerGrade: cust.grade || 'NORMAL',
          },
        }).catch(() => {});
      }
    }
  } catch (err: any) {
    // 롤백: 환불 전표 삭제 (cascade)
    if (returnOrderId) {
      await db.from('return_orders').delete().eq('id', returnOrderId);
    }
    return { error: `환불 처리 실패: ${err.message}` };
  }

  writeAuditLog({
    userId,
    action: 'CREATE',
    tableName: 'return_orders',
    description: `환불 처리: ${returnNumber}, 금액: ${params.items.reduce((s, i) => s + i.quantity * i.unit_price, 0).toLocaleString()}원`,
  }).catch(() => {});

  revalidatePath('/pos');
  revalidatePath('/inventory');
  revalidatePath('/customers');
  revalidatePath('/reports');
  return { success: true, returnNumber };
}

// ─── 환불 내역 조회 ────────────────────────────────────────────────────────────

export async function getReturnOrders(branchId?: string) {
  const supabase = await createClient();
  let q = (supabase as any)
    .from('return_orders')
    .select(`
      *,
      original_order:sales_orders(order_number, total_amount),
      customer:customers(name, phone),
      processed_by_user:users!return_orders_processed_by_fkey(name),
      items:return_order_items(*, product:products(name))
    `)
    .order('processed_at', { ascending: false });

  if (branchId) q = q.eq('branch_id', branchId);

  const { data, error } = await q.limit(100);
  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}

// ─── 주문 검색 (환불 처리용 — 고객명/날짜/최근거래) ──────────────────────────

export async function searchSalesOrdersForRefund(params: {
  branchId?: string;
  customerQuery?: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  limit?: number;
}) {
  const supabase = await createClient();
  const db = supabase as any;

  let q = db
    .from('sales_orders')
    .select(`
      id, order_number, ordered_at, total_amount, payment_method, status,
      customer:customers(id, name, phone),
      branch:branches(id, name, code)
    `)
    .in('status', ['COMPLETED', 'PARTIALLY_REFUNDED'])
    .order('ordered_at', { ascending: false })
    .limit(params.limit || 30);

  if (params.branchId) q = q.eq('branch_id', params.branchId);
  if (params.startDate) q = q.gte('ordered_at', `${params.startDate}T00:00:00`);
  if (params.endDate) q = q.lte('ordered_at', `${params.endDate}T23:59:59`);

  // 고객명/전화 검색은 customer 조인 필터가 까다로워 customer_id로 1차 필터
  if (params.customerQuery && params.customerQuery.trim()) {
    const cq = params.customerQuery.trim();
    const { data: cust } = await db
      .from('customers')
      .select('id')
      .or(`name.ilike.%${cq}%,phone.ilike.%${cq}%`)
      .limit(50);
    const ids = (cust || []).map((c: any) => c.id);
    if (ids.length === 0) return { data: [] };
    q = q.in('customer_id', ids);
  }

  const { data, error } = await q;
  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}

// ─── 주문 조회 (환불 처리용) ──────────────────────────────────────────────────

export async function getSalesOrderForRefund(orderNumber: string) {
  const supabase = await createClient();
  const { data, error } = await (supabase as any)
    .from('sales_orders')
    .select(`
      *,
      customer:customers(id, name, phone, grade),
      branch:branches(id, name, code),
      items:sales_order_items(
        id, quantity, unit_price, total_price,
        product:products(id, name, code)
      )
    `)
    .eq('order_number', orderNumber)
    .single();

  if (error) return { data: null, error: '주문을 찾을 수 없습니다.' };
  return { data };
}
