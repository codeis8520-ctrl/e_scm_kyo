import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const searchParams = request.nextUrl.searchParams;
  const type = searchParams.get('type'); // channel_sales | branch_inventory | recent_orders
  const channel = searchParams.get('channel');
  const branchId = searchParams.get('branch_id');
  const periodStart = searchParams.get('start');
  const periodEnd = searchParams.get('end');

  const cookieStore = await cookies();
  const userRole = cookieStore.get('user_role')?.value;
  const userBranchId = cookieStore.get('user_branch_id')?.value;
  const isBranchUser = userRole === 'BRANCH_STAFF' || userRole === 'PHARMACY_STAFF';
  const effectiveBranchId = isBranchUser ? (userBranchId || null) : branchId;

  if (!type) {
    return NextResponse.json({ error: 'type parameter required' }, { status: 400 });
  }

  const SALES_STATUSES = ['COMPLETED', 'PARTIALLY_REFUNDED'];

  if (type === 'channel_sales') {
    // 채널별 매출 상세 — 개별 주문 목록
    const isB2B = channel === 'B2B';

    if (isB2B) {
      let q = supabase
        .from('b2b_sales_orders')
        .select('id, order_number, total_amount, status, delivered_at, client:b2b_clients(company_name), branch:branches(name), items:b2b_sales_order_items(product:products(name), quantity, unit_price)')
        .in('status', ['DELIVERED', 'PARTIALLY_SETTLED', 'SETTLED'])
        .order('delivered_at', { ascending: false })
        .limit(100);
      if (periodStart) q = q.gte('delivered_at', `${periodStart}T00:00:00`);
      if (periodEnd) q = q.lte('delivered_at', `${periodEnd}T23:59:59`);
      if (effectiveBranchId && effectiveBranchId !== 'ALL') q = q.eq('branch_id', effectiveBranchId);

      const { data, error } = await q;
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      const orders = (data || []).map((o: any) => ({
        id: o.id,
        order_number: o.order_number,
        channel: 'B2B',
        branch_name: o.branch?.name || '알 수 없음',
        customer_name: o.client?.company_name || '-',
        total_amount: o.total_amount,
        status: o.status,
        ordered_at: o.delivered_at,
        items: (o.items || []).map((i: any) => ({
          product_name: i.product?.name || '알 수 없음',
          quantity: i.quantity,
          unit_price: i.unit_price,
        })),
      }));
      return NextResponse.json({ orders });
    }

    let q = supabase
      .from('sales_orders')
      .select('id, order_number, channel, total_amount, status, ordered_at, cafe24_order_id, customer:customers(name), branch:branches(name), items:sales_order_items(product:products(name), quantity, unit_price)')
      .in('status', SALES_STATUSES)
      .order('ordered_at', { ascending: false })
      .limit(100);

    if (channel && channel !== 'ALL') q = q.eq('channel', channel);
    if (periodStart) q = q.gte('ordered_at', `${periodStart}T00:00:00`);
    if (periodEnd) q = q.lte('ordered_at', `${periodEnd}T23:59:59`);
    if (effectiveBranchId && effectiveBranchId !== 'ALL') q = q.eq('branch_id', effectiveBranchId);

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const orders = (data || []).map((o: any) => ({
      id: o.id,
      order_number: o.order_number,
      channel: o.channel,
      branch_name: o.branch?.name || '알 수 없음',
      customer_name: o.customer?.name || '-',
      total_amount: o.total_amount,
      status: o.status,
      ordered_at: o.ordered_at,
      cafe24_order_id: o.cafe24_order_id,
      items: (o.items || []).map((i: any) => ({
        product_name: i.product?.name || '알 수 없음',
        quantity: i.quantity,
        unit_price: i.unit_price,
      })),
    }));
    return NextResponse.json({ orders });
  }

  if (type === 'branch_inventory') {
    // 지점별 재고 상세
    let q = supabase
      .from('inventories')
      .select('id, quantity, safety_stock, product:products(name, sku), branch:branches(id, name)')
      .gt('safety_stock', 0);

    if (effectiveBranchId && effectiveBranchId !== 'ALL') {
      q = q.eq('branch_id', effectiveBranchId);
    } else if (branchId && branchId !== 'ALL') {
      q = q.eq('branch_id', branchId);
    }

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const items = (data || []).map((inv: any) => ({
      id: inv.id,
      product_name: inv.product?.name || '알 수 없음',
      sku: inv.product?.sku || '-',
      branch_name: inv.branch?.name || '알 수 없음',
      branch_id: inv.branch?.id,
      quantity: inv.quantity,
      safety_stock: inv.safety_stock,
      is_low: inv.quantity < inv.safety_stock,
    }));

    return NextResponse.json({ items });
  }

  if (type === 'recent_orders') {
    // 최근 주문 상세
    let q = supabase
      .from('sales_orders')
      .select('id, order_number, channel, total_amount, status, ordered_at, cafe24_order_id, payment_method, customer:customers(name, phone), branch:branches(name), items:sales_order_items(product:products(name), quantity, unit_price, subtotal)')
      .not('status', 'eq', 'CANCELLED')
      .order('ordered_at', { ascending: false })
      .limit(50);

    if (periodStart) q = q.gte('ordered_at', `${periodStart}T00:00:00`);
    if (periodEnd) q = q.lte('ordered_at', `${periodEnd}T23:59:59`);
    if (effectiveBranchId && effectiveBranchId !== 'ALL') q = q.eq('branch_id', effectiveBranchId);

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const orders = (data || []).map((o: any) => ({
      id: o.id,
      order_number: o.order_number,
      channel: o.channel,
      branch_name: o.branch?.name || '알 수 없음',
      customer_name: o.customer?.name || '-',
      customer_phone: o.customer?.phone || '-',
      total_amount: o.total_amount,
      status: o.status,
      ordered_at: o.ordered_at,
      payment_method: o.payment_method,
      cafe24_order_id: o.cafe24_order_id,
      items: (o.items || []).map((i: any) => ({
        product_name: i.product?.name || '알 수 없음',
        quantity: i.quantity,
        unit_price: i.unit_price,
        subtotal: i.subtotal,
      })),
    }));
    return NextResponse.json({ orders });
  }

  return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
}
