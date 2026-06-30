/**
 * 온라인(자사몰) 주문 재고 차감 — #14 후속
 *
 * 카페24/자사몰 주문도 오프라인 판매처럼 재고를 차감하고 inventory_movements(재고 이력)에 남긴다.
 *  - 차감 지점 = 주문의 sales_orders.branch_id (카페24는 '자사몰' 지점).
 *  - 매핑된(product_id 있는) 품목만 대상. 미매핑 품목은 매핑 후 차감(멱등 재호출로 자동).
 *  - track_inventory=false(서비스/팬텀) 제품 제외.
 *  - 멱등: 품목(sales_order_items.id)당 movement(reference_type='ONLINE_SALE')가 있으면 skip.
 *    → 동기화가 매일 돌아도, 나중에 매핑돼도 이중 차감 없음.
 *
 * 호출처: sync-orders(매 동기화·주 경로) + createCafe24ProductMap(매핑 즉시 차감).
 * 음수 재고 허용(POS 패턴과 동일) — 자사몰 재고행 없으면 음수로 생성.
 *
 * 컷오프(ONLINE_DEDUCT_CUTOFF) 이전 주문은 차감하지 않는다 — 시행 전 과거 온라인 판매를
 * 소급 일괄 차감하면 현재 재고가 왜곡되므로, 시행일 이후 주문만 forward 차감.
 * (과거 소급이 필요하면 컷오프를 낮춰 별도 1회 동기화)
 *
 * Known Gap: 주문 취소/반품 시 재고 복원(IN)은 본 함수 범위 밖(동기화는 취소건 미처리).
 */
// 자사몰 재고 차감 시행일(KST). 이 일자 이상(ordered_at) 주문만 차감.
const ONLINE_DEDUCT_CUTOFF = '2026-06-17';

export async function deductOnlineOrderInventory(
  sb: any,
  salesOrderId: string,
): Promise<number> {
  const { data: order } = await sb
    .from('sales_orders')
    .select('id, branch_id, order_number, status, ordered_at')
    .eq('id', salesOrderId)
    .maybeSingle();
  if (!order?.branch_id) return 0;
  // 취소/환불 주문은 차감하지 않음
  if (['CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(order.status)) return 0;
  // 시행일 이전 주문은 소급 차감하지 않음(과거 재고 왜곡 방지)
  if (order.ordered_at && new Date(order.ordered_at) < new Date(`${ONLINE_DEDUCT_CUTOFF}T00:00:00+09:00`)) return 0;

  const { data: items } = await sb
    .from('sales_order_items')
    .select('id, product_id, quantity, product:products(track_inventory)')
    .eq('sales_order_id', salesOrderId);

  let deducted = 0;
  for (const it of (items ?? []) as any[]) {
    if (!it.product_id) continue;                       // 미매핑 → skip(매핑 후 재호출 시 차감)
    if (it.product?.track_inventory === false) continue; // 재고 미추적 제품 제외
    const qty = Number(it.quantity) || 0;
    if (qty <= 0) continue;

    // 멱등 가드 — 이 품목이 이미 차감됐으면 skip
    const { data: existing } = await sb
      .from('inventory_movements')
      .select('id')
      .eq('reference_type', 'ONLINE_SALE')
      .eq('reference_id', it.id)
      .limit(1);
    if (existing?.length) continue;

    // inventories 차감(없으면 음수 신규 — 추후 입고 복원)
    const { data: inv } = await sb
      .from('inventories')
      .select('id, quantity')
      .eq('branch_id', order.branch_id)
      .eq('product_id', it.product_id)
      .maybeSingle();
    if (inv) {
      await sb.from('inventories').update({ quantity: (Number(inv.quantity) || 0) - qty }).eq('id', inv.id);
    } else {
      await sb.from('inventories').insert({
        branch_id: order.branch_id,
        product_id: it.product_id,
        quantity: -qty,
        safety_stock: 0,
      });
    }

    await sb.from('inventory_movements').insert({
      branch_id: order.branch_id,
      product_id: it.product_id,
      movement_type: 'OUT',
      quantity: qty,
      reference_id: it.id,            // 품목 단위 멱등키
      reference_type: 'ONLINE_SALE',
      memo: `자사몰 판매 차감: ${order.order_number ?? ''}`.trim(),
      // #92 이력 일시 = 자사몰 판매일자(ordered_at). 동기화 시각 아님. 없으면 DB 기본 now().
      ...(order.ordered_at ? { created_at: order.ordered_at } : {}),
    });
    deducted++;
  }
  return deducted;
}

/**
 * 온라인(자사몰) 주문 재고 복원 — #48 Phase 1 (deductOnlineOrderInventory의 역연산)
 *
 * 카페24 취소/환불 webhook에서 ONLINE_SALE로 차감했던 재고를 IN으로 되돌린다.
 *  - 복원 지점 = 주문의 sales_orders.branch_id('자사몰').
 *  - **차감된 품목만 복원**: 해당 품목(item.id)에 ONLINE_SALE movement가 있을 때만 IN.
 *    → 컷오프(2026-06-17) 이전·미매핑·track_inventory=false건은 애초 ONLINE_SALE이 없으므로 자동 무대상.
 *    (ordered_at 별도 비교 불요 — 차감 멱등키 재사용으로 대칭 보장)
 *  - 복원 멱등: 같은 item.id에 refType movement가 이미 있으면 skip(이중 복원 방지).
 *
 * @param refType 'ONLINE_SALE_CANCEL'(취소) | 'ONLINE_REFUND'(전체환불) — 멱등키 분리
 */
export async function restoreOnlineOrderInventory(
  sb: any,
  salesOrderId: string,
  refType: 'ONLINE_SALE_CANCEL' | 'ONLINE_REFUND',
): Promise<number> {
  const { data: order } = await sb
    .from('sales_orders')
    .select('id, branch_id, order_number')
    .eq('id', salesOrderId)
    .maybeSingle();
  if (!order?.branch_id) return 0;

  const { data: items } = await sb
    .from('sales_order_items')
    .select('id, product_id, quantity, product:products(track_inventory)')
    .eq('sales_order_id', salesOrderId);

  let restored = 0;
  for (const it of (items ?? []) as any[]) {
    if (!it.product_id) continue;
    if (it.product?.track_inventory === false) continue;
    const qty = Number(it.quantity) || 0;
    if (qty <= 0) continue;

    // 차감 가드 — 이 품목이 ONLINE_SALE로 차감된 적 없으면 복원 대상 아님(컷오프·미매핑 자동 필터)
    const { data: deducted } = await sb
      .from('inventory_movements')
      .select('id')
      .eq('reference_type', 'ONLINE_SALE')
      .eq('reference_id', it.id)
      .limit(1);
    if (!deducted?.length) continue;

    // 복원 멱등 가드 — 이미 복원됐으면 skip
    const { data: alreadyRestored } = await sb
      .from('inventory_movements')
      .select('id')
      .eq('reference_type', refType)
      .eq('reference_id', it.id)
      .limit(1);
    if (alreadyRestored?.length) continue;

    // inventories 복원(없으면 신규 qty)
    const { data: inv } = await sb
      .from('inventories')
      .select('id, quantity')
      .eq('branch_id', order.branch_id)
      .eq('product_id', it.product_id)
      .maybeSingle();
    if (inv) {
      await sb.from('inventories').update({ quantity: (Number(inv.quantity) || 0) + qty }).eq('id', inv.id);
    } else {
      await sb.from('inventories').insert({
        branch_id: order.branch_id,
        product_id: it.product_id,
        quantity: qty,
        safety_stock: 0,
      });
    }

    await sb.from('inventory_movements').insert({
      branch_id: order.branch_id,
      product_id: it.product_id,
      movement_type: 'IN',
      quantity: qty,
      reference_id: it.id,            // 품목 단위 멱등키
      reference_type: refType,
      memo: `자사몰 취소 재고 복원: ${order.order_number ?? ''}`.trim(),
    });
    restored++;
  }
  return restored;
}
