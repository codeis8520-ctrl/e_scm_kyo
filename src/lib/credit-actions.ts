'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { requireSession, writeAuditLog } from '@/lib/session';

/**
 * 외상 미수금 주문 취소 (삭제 대신 CANCELLED 처리)
 *
 * 동작:
 *   1. 주문 상태를 CANCELLED로 변경
 *   2. 차감했던 재고를 복원 (inventory + inventory_movements IN)
 *   3. 적립 포인트 차감
 *   4. 외상매출금 분개 역분개
 *
 * 조건: payment_method='credit' AND credit_settled=false 인 주문만 취소 가능
 */
export async function cancelCreditOrder(params: {
  orderId: string;
  reason?: string;
  userId?: string;
}) {
  let session;
  try { session = await requireSession(); } catch (e: any) { return { error: e.message }; }

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
  if (order.payment_method !== 'credit') return { error: '외상 결제 주문만 취소 가능합니다.' };
  if (order.credit_settled) return { error: '이미 수금 처리된 주문은 취소할 수 없습니다. 환불 처리를 이용하세요.' };
  if (order.status === 'CANCELLED') return { error: '이미 취소된 주문입니다.' };

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
        reference_type: 'CREDIT_CANCEL',
        memo: `외상 취소 재고 복원 (${order.order_number})${params.reason ? ' — ' + params.reason : ''}`,
      });
    }

    // 3. 적립 포인트 차감 (적립된 것이 있다면)
    if (order.customer_id && order.points_earned > 0) {
      const { data: lastHist } = await db
        .from('point_history')
        .select('balance')
        .eq('customer_id', order.customer_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const currentBalance = lastHist?.balance || 0;
      const newBalance = Math.max(0, currentBalance - order.points_earned);

      await db.from('point_history').insert({
        customer_id: order.customer_id,
        sales_order_id: order.id,
        type: 'adjust',
        points: -order.points_earned,
        balance: newBalance,
        description: `외상 취소 포인트 차감 (${order.order_number})`,
      });
    }

    // 4. 외상매출금 역분개 — 원래 분개 추적 포함
    try {
      const { createSaleJournal } = await import('@/lib/accounting-actions');

      // 원래 매출 분개 ID 조회
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
        orderDate: new Date().toISOString().slice(0, 10),
        totalAmount: -Number(order.total_amount),
        paymentMethod: 'credit',
        cogs: 0,
        sourceType: 'CREDIT_CANCEL',
        reversalOf: originalEntry?.id || undefined,
        createdBy: params.userId || undefined,
      });
    } catch {
      // 역분개 실패는 경고만 (주문 취소 자체는 진행)
    }

    // 5. 주문 상태 변경
    await db.from('sales_orders')
      .update({
        status: 'CANCELLED',
        memo: (order.memo ? order.memo + '\n' : '') + `[외상 취소] ${params.reason || '관리자 요청'} (${new Date().toISOString().slice(0, 10)})`,
      })
      .eq('id', order.id);

  } catch (err: any) {
    return { error: `취소 처리 실패: ${err.message}` };
  }

  writeAuditLog({
    userId: session.id,
    action: 'DELETE',
    tableName: 'sales_orders',
    description: `외상 취소: ${order.order_number}, 금액: ${Number(order.total_amount).toLocaleString()}원, 사유: ${params.reason || '미지정'}`,
  }).catch(() => {});

  revalidatePath('/credit');
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
