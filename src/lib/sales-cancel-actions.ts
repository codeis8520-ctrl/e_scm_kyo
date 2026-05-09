'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { requireSession, writeAuditLog } from '@/lib/session';
import { kstTodayString } from '@/lib/date';

/**
 * 판매 취소 (CANCELLED) — 거래 자체를 무르는 처리
 *
 * "환불(return_orders)"과 다른 점:
 *   - 환불은 매출은 발생했고 사후에 반품 발생 → 매출반품 회계 처리
 *   - 취소는 거래가 잘못 등록되어 처음부터 없던 일로 처리 → 매출 자체를 역분개
 *
 * 동작:
 *   1. status → CANCELLED, memo에 취소 사유 기록
 *   2. 차감했던 재고 복원 (inventory + inventory_movements IN, ref_type=SALE_CANCEL)
 *   3. 적립 포인트 차감 (points_earned > 0)
 *   4. 사용 포인트 환원 (points_used > 0) — 차감했던 포인트를 다시 적립
 *   5. 매출 분개 역분개 (createSaleJournal with sourceType=SALE_CANCEL, 음수 금액)
 *
 * 조건:
 *   - status === 'COMPLETED' (이미 환불·취소된 건은 불가)
 *   - 외상 미수금이면 cancelCreditOrder 로 위임 (기존 흐름 재사용)
 *
 * 주의:
 *   - 카드 결제 건은 PG/단말기 측 결제 취소가 별도로 필요 (시스템 외부 작업).
 *     호출자(UI)가 사전 안내하고 본 액션은 ERP 측 데이터만 정리.
 *   - 배송이 진행된 건은 취소 대신 환불·반품으로 처리하는 것이 일반적.
 *     UI에서 사전 안내 권장.
 */
export async function cancelSalesOrder(params: {
  orderId: string;
  reason: string;
}) {
  let session;
  try { session = await requireSession(); } catch (e: any) { return { error: e.message }; }

  if (!params.reason?.trim()) return { error: '취소 사유를 입력해주세요.' };

  const supabase = await createClient();
  const db = supabase as any;

  // 1. 주문 조회
  const { data: order, error: fetchErr } = await db
    .from('sales_orders')
    .select(`
      *,
      order_items:sales_order_items(*),
      branch:branches(id, name, code)
    `)
    .eq('id', params.orderId)
    .single();

  if (fetchErr || !order) return { error: '주문을 찾을 수 없습니다.' };
  if (order.status === 'CANCELLED') return { error: '이미 취소된 주문입니다.' };
  if (order.status === 'REFUNDED' || order.status === 'PARTIALLY_REFUNDED') {
    return { error: '환불 처리 중인 주문은 취소할 수 없습니다. 환불 흐름을 이어주세요.' };
  }
  if (order.status !== 'COMPLETED') {
    return { error: `현재 상태(${order.status})에서는 취소할 수 없습니다.` };
  }

  // 외상 미수금은 기존 cancelCreditOrder 로직 재사용
  if (order.payment_method === 'credit' && !order.credit_settled) {
    const { cancelCreditOrder } = await import('@/lib/credit-actions');
    return cancelCreditOrder({ orderId: params.orderId, reason: params.reason, userId: session.id });
  }

  try {
    // 2. 재고 복원
    for (const item of (order.order_items || []) as any[]) {
      const { data: inv } = await db
        .from('inventories')
        .select('id, quantity')
        .eq('branch_id', order.branch_id)
        .eq('product_id', item.product_id)
        .maybeSingle();

      if (inv) {
        await db.from('inventories')
          .update({ quantity: inv.quantity + item.quantity })
          .eq('id', inv.id);
      } else {
        await db.from('inventories').insert({
          branch_id: order.branch_id,
          product_id: item.product_id,
          quantity: item.quantity,
          safety_stock: 0,
        });
      }

      await db.from('inventory_movements').insert({
        branch_id: order.branch_id,
        product_id: item.product_id,
        movement_type: 'IN',
        quantity: item.quantity,
        reference_id: order.id,
        reference_type: 'SALE_CANCEL',
        memo: `판매 취소 재고 복원 (${order.order_number}) — ${params.reason}`,
      });
    }

    // 3. 적립 포인트 차감
    if (order.customer_id && Number(order.points_earned) > 0) {
      const { data: lastHist } = await db
        .from('point_history')
        .select('balance')
        .eq('customer_id', order.customer_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const currentBalance = lastHist?.balance || 0;
      const newBalance = Math.max(0, currentBalance - Number(order.points_earned));

      await db.from('point_history').insert({
        customer_id: order.customer_id,
        sales_order_id: order.id,
        type: 'adjust',
        points: -Number(order.points_earned),
        balance: newBalance,
        description: `판매 취소 적립 차감 (${order.order_number})`,
      });
    }

    // 4. 사용 포인트 환원 (다시 적립)
    if (order.customer_id && Number(order.points_used) > 0) {
      const { data: lastHist } = await db
        .from('point_history')
        .select('balance')
        .eq('customer_id', order.customer_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const currentBalance = lastHist?.balance || 0;
      const newBalance = currentBalance + Number(order.points_used);

      await db.from('point_history').insert({
        customer_id: order.customer_id,
        sales_order_id: order.id,
        type: 'adjust',
        points: Number(order.points_used),
        balance: newBalance,
        description: `판매 취소 사용 포인트 환원 (${order.order_number})`,
      });
    }

    // 5. 매출 분개 역분개
    try {
      const { createSaleJournal } = await import('@/lib/accounting-actions');
      const { data: originalEntry } = await db
        .from('journal_entries')
        .select('id')
        .eq('source_id', order.id)
        .eq('source_type', 'SALE')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      await createSaleJournal({
        orderId: order.id,
        orderNumber: `CANCEL-${order.order_number}`,
        orderDate: kstTodayString(),
        totalAmount: -Number(order.total_amount),
        paymentMethod: order.payment_method,
        cogs: 0,
        // 원본의 과세 금액 스냅샷 사용 — VAT 역분개 정확도 ↑
        taxableAmount: order.taxable_amount !== null && order.taxable_amount !== undefined
          ? -Number(order.taxable_amount)
          : undefined,
        sourceType: 'SALE_CANCEL',
        reversalOf: originalEntry?.id || undefined,
        createdBy: session.id,
      });
    } catch {
      // 역분개 실패는 경고만 (취소 자체는 진행)
    }

    // 6. 주문 상태 변경
    const memoAppend = `[판매 취소] ${params.reason} (${kstTodayString()})`;
    await db.from('sales_orders')
      .update({
        status: 'CANCELLED',
        memo: order.memo ? `${order.memo}\n${memoAppend}` : memoAppend,
      })
      .eq('id', order.id);

  } catch (err: any) {
    return { error: `취소 처리 실패: ${err.message}` };
  }

  writeAuditLog({
    userId: session.id,
    action: 'DELETE',
    tableName: 'sales_orders',
    description: `판매 취소: ${order.order_number}, 결제수단: ${order.payment_method}, 금액: ${Number(order.total_amount).toLocaleString()}원, 사유: ${params.reason}`,
  }).catch(() => {});

  revalidatePath('/pos');
  revalidatePath('/inventory');
  revalidatePath('/reports');
  revalidatePath('/accounting');

  return {
    success: true,
    orderNumber: order.order_number,
    amount: Number(order.total_amount),
  };
}
