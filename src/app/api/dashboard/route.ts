import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { kstDayStart, kstDayEnd, kstTodayString } from '@/lib/date';

interface ChannelSales {
  channel: string;
  total: number;
  count: number;
}

interface BranchInventory {
  branch_id: string;
  branch_name: string;
  total_products: number;
  low_stock_items: number;
}

interface RecentOrder {
  id: string;
  order_number: string;
  channel: string;
  branch_name: string;
  total_amount: number;
  status: string;
  created_at: string;
  cafe24_order_id: string | null;
  items: { product_name: string; quantity: number }[];
}

interface LowInventoryItem {
  id: string;
  quantity: number;
  safety_stock: number;
  product_name: string;
  branch_name: string;
}

function getPeriodRange(baseDate: string, period: string): { start: string; end: string } {
  const d = new Date(baseDate + 'T00:00:00');
  if (period === 'daily') {
    return { start: baseDate, end: baseDate };
  } else if (period === 'weekly') {
    const day = d.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(d);
    monday.setDate(d.getDate() + mondayOffset);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return {
      start: monday.toISOString().split('T')[0],
      end: sunday.toISOString().split('T')[0],
    };
  } else {
    // monthly
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return {
      start: baseDate.substring(0, 7) + '-01',
      end: lastDay.toISOString().split('T')[0],
    };
  }
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const searchParams = request.nextUrl.searchParams;
  const channel = searchParams.get('channel');
  const period = searchParams.get('period') || 'monthly';
  const dateParam = searchParams.get('date');

  const cookieStore = await cookies();
  const userRole = cookieStore.get('user_role')?.value;
  const userBranchId = cookieStore.get('user_branch_id')?.value;
  const isBranchUser = userRole === 'BRANCH_STAFF' || userRole === 'PHARMACY_STAFF';
  const branchId = isBranchUser ? (userBranchId || null) : searchParams.get('branch_id');

  const today = dateParam || kstTodayString();
  const { start: periodStart, end: periodEnd } = getPeriodRange(today, period);

  const SALES_STATUSES = ['COMPLETED', 'PARTIALLY_REFUNDED'];

  // 기간 매출 (선택된 기간 전체) — KST 경계로 해석
  const periodStartISO = kstDayStart(periodStart);
  const periodEndISO = kstDayEnd(periodEnd);

  let periodSalesQuery = supabase
    .from('sales_orders')
    .select('total_amount, channel, cafe24_order_id, created_at')
    .in('status', SALES_STATUSES)
    .gte('ordered_at', periodStartISO)
    .lte('ordered_at', periodEndISO);

  let recentOrdersQuery = supabase
    .from('sales_orders')
    .select('id, order_number, channel, total_amount, status, created_at, cafe24_order_id, branch:branches(name), items:sales_order_items(product:products(name), quantity)')
    .not('status', 'eq', 'CANCELLED')
    .gte('ordered_at', periodStartISO)
    .lte('ordered_at', periodEndISO)
    .order('created_at', { ascending: false })
    .limit(20);

  const isB2BFilter = channel === 'B2B';
  if (channel && channel !== 'ALL' && !isB2BFilter) {
    periodSalesQuery = periodSalesQuery.eq('channel', channel);
    recentOrdersQuery = recentOrdersQuery.eq('channel', channel);
  }
  if (isB2BFilter) {
    periodSalesQuery = periodSalesQuery.eq('channel', '__B2B_NONE__');
    recentOrdersQuery = recentOrdersQuery.eq('channel', '__B2B_NONE__');
  }

  if (branchId && branchId !== 'ALL') {
    periodSalesQuery = periodSalesQuery.eq('branch_id', branchId);
    recentOrdersQuery = recentOrdersQuery.eq('branch_id', branchId);
  }

  const B2B_STATUSES = ['DELIVERED', 'PARTIALLY_SETTLED', 'SETTLED'];

  let b2bPeriodQuery = supabase
    .from('b2b_sales_orders')
    .select('total_amount, delivered_at')
    .in('status', B2B_STATUSES)
    .gte('delivered_at', periodStartISO)
    .lte('delivered_at', periodEndISO);

  if (branchId && branchId !== 'ALL') {
    b2bPeriodQuery = b2bPeriodQuery.eq('branch_id', branchId);
  }

  const [
    periodSalesResult,
    channelSalesResult,
    recentOrdersResult,
    lowInventoryResult,
    branchesResult,
    onlineOrdersResult,
    monthPurchaseResult,
    monthReturnResult,
    pendingPOResult,
    b2bPeriodResult,
  ] = await Promise.all([
    periodSalesQuery,
    (() => {
      let q = supabase
        .from('sales_orders')
        .select('channel, total_amount')
        .in('status', SALES_STATUSES)
        .gte('ordered_at', periodStartISO)
        .lte('ordered_at', periodEndISO);
      if (branchId && branchId !== 'ALL') q = q.eq('branch_id', branchId);
      return q;
    })(),
    recentOrdersQuery,
    (async () => {
      let q = supabase
        .from('inventories')
        .select('id, quantity, safety_stock, product:products(name), branch:branches(id, name)')
        .gt('safety_stock', 0);
      if (branchId && branchId !== 'ALL') q = q.eq('branch_id', branchId);
      const { data } = await q;
      return { data: (data || []).filter((inv: any) => inv.quantity < inv.safety_stock).slice(0, 30) };
    })(),
    (() => {
      let q = supabase.from('branches').select('id, name');
      if (branchId && branchId !== 'ALL') q = q.eq('id', branchId);
      return q;
    })(),
    (() => {
      let q = supabase
        .from('sales_orders')
        .select('total_amount')
        .eq('channel', 'ONLINE')
        .in('status', SALES_STATUSES)
        .gte('ordered_at', periodStartISO)
        .lte('ordered_at', periodEndISO);
      if (branchId && branchId !== 'ALL') q = q.eq('branch_id', branchId);
      return q;
    })(),
    (() => {
      let q = supabase
        .from('purchase_orders')
        .select('total_amount')
        .in('status', ['CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED'])
        .gte('ordered_at', periodStartISO)
        .lte('ordered_at', periodEndISO);
      if (branchId && branchId !== 'ALL') q = q.eq('branch_id', branchId);
      return q;
    })(),
    (() => {
      let q = supabase
        .from('return_orders')
        .select('refund_amount')
        .eq('status', 'COMPLETED')
        .gte('processed_at', periodStartISO)
        .lte('processed_at', periodEndISO);
      if (branchId && branchId !== 'ALL') q = q.eq('branch_id', branchId);
      return q;
    })(),
    (() => {
      let q = supabase
        .from('purchase_orders')
        .select('id', { count: 'exact', head: true })
        .in('status', ['DRAFT', 'CONFIRMED', 'PARTIALLY_RECEIVED']);
      if (branchId && branchId !== 'ALL') q = q.eq('branch_id', branchId);
      return q;
    })(),
    b2bPeriodQuery,
  ]);

  const periodSales = (periodSalesResult.data || []) as { total_amount: number }[];
  const channelSalesRaw = channelSalesResult.data || [];
  const recentOrders = recentOrdersResult.data || [];
  const lowInventory = (lowInventoryResult.data || []) as any[];
  const branches = (branchesResult.data || []) as { id: string; name: string }[];
  const onlineOrders = onlineOrdersResult.data || [];
  const monthPurchaseTotal = (monthPurchaseResult.data || []).reduce((s: number, p: any) => s + (p.total_amount || 0), 0);
  const monthReturnTotal   = (monthReturnResult.data || []).reduce((s: number, r: any) => s + (r.refund_amount || 0), 0);
  const pendingPOCount     = pendingPOResult.count ?? 0;

  const b2bPeriodSales = (b2bPeriodResult.data || []) as { total_amount: number }[];
  const b2bPeriodTotal = b2bPeriodSales.reduce((s, o) => s + (o.total_amount || 0), 0);
  const b2bPeriodCount = b2bPeriodSales.length;

  const channelSales: ChannelSales[] = ['STORE', 'DEPT_STORE', 'ONLINE', 'EVENT']
    .map((ch) => {
      const chData = channelSalesRaw.filter((s: any) => s.channel === ch);
      return {
        channel: ch,
        total: chData.reduce((sum: number, s: any) => sum + (s.total_amount || 0), 0),
        count: chData.length,
      };
    })
    .filter((ch) => ch.count > 0);

  if (b2bPeriodCount > 0 && (!channel || channel === 'ALL' || channel === 'B2B')) {
    channelSales.push({ channel: 'B2B', total: b2bPeriodTotal, count: b2bPeriodCount });
  }

  const branchInventoryMap = new Map<string, BranchInventory>();
  for (const branch of branches) {
    branchInventoryMap.set(branch.id, {
      branch_id: branch.id,
      branch_name: branch.name,
      total_products: 0,
      low_stock_items: 0,
    });
  }
  for (const inv of lowInventory) {
    const invBranchId = (inv.branch as any)?.id;
    if (invBranchId && branchInventoryMap.has(invBranchId)) {
      const current = branchInventoryMap.get(invBranchId)!;
      current.low_stock_items++;
      current.total_products++;
    }
  }
  const branchInventory: BranchInventory[] = Array.from(branchInventoryMap.values());

  const recentOrdersFormatted: RecentOrder[] = recentOrders.map((order: any) => ({
    id: order.id,
    order_number: order.order_number,
    channel: order.channel,
    branch_name: (order.branch as any)?.name || '알 수 없음',
    total_amount: order.total_amount,
    status: order.status,
    created_at: order.created_at,
    cafe24_order_id: order.cafe24_order_id,
    items: (order.items || []).map((item: any) => ({
      product_name: (item.product as any)?.name || '알 수 없음',
      quantity: item.quantity,
    })),
  }));

  const lowInventoryFormatted: LowInventoryItem[] = lowInventory.map((inv: any) => ({
    id: inv.id,
    quantity: inv.quantity,
    safety_stock: inv.safety_stock,
    product_name: (inv.product as any)?.name || '알 수 없음',
    branch_name: (inv.branch as any)?.name || '알 수 없음',
  }));

  const includeB2B = !channel || channel === 'ALL' || channel === 'B2B';
  const periodTotal = periodSales.reduce((sum, o) => sum + (o.total_amount || 0), 0) + (includeB2B ? b2bPeriodTotal : 0);
  const periodCount = periodSales.length + (includeB2B ? b2bPeriodCount : 0);
  const onlineAmount = onlineOrders.reduce((sum: number, o: any) => sum + (o.total_amount || 0), 0);

  return NextResponse.json({
    periodTotal,
    periodCount,
    periodStart,
    periodEnd,
    channelSales,
    branchInventory,
    recentOrders: recentOrdersFormatted,
    lowInventory: lowInventoryFormatted,
    onlineOrders: onlineOrders.length,
    onlineAmount,
    monthPurchaseTotal,
    monthReturnTotal,
    pendingPOCount,
  });
}
