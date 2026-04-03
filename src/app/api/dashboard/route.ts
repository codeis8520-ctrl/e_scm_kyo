import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const searchParams = request.nextUrl.searchParams;
  const channel = searchParams.get('channel');
  const branchId = searchParams.get('branch_id');

  const today = new Date().toISOString().split('T')[0];
  const monthStart = today.substring(0, 7) + '-01';

  let salesQuery = supabase
    .from('sales_orders')
    .select('total_amount, channel, cafe24_order_id, created_at')
    .gte('ordered_at', `${today}T00:00:00`)
    .lt('ordered_at', `${today}T23:59:59`);

  let monthSalesQuery = supabase
    .from('sales_orders')
    .select('total_amount')
    .gte('ordered_at', `${monthStart}T00:00:00`);

  let recentOrdersQuery = supabase
    .from('sales_orders')
    .select('id, order_number, channel, total_amount, status, created_at, cafe24_order_id, branch:branches(name), items:sales_order_items(product:products(name), quantity)')
    .order('created_at', { ascending: false })
    .limit(20);

  if (channel && channel !== 'ALL') {
    salesQuery = salesQuery.eq('channel', channel);
    monthSalesQuery = monthSalesQuery.eq('channel', channel);
    recentOrdersQuery = recentOrdersQuery.eq('channel', channel);
  }

  if (branchId && branchId !== 'ALL') {
    salesQuery = salesQuery.eq('branch_id', branchId);
    monthSalesQuery = monthSalesQuery.eq('branch_id', branchId);
    recentOrdersQuery = recentOrdersQuery.eq('branch_id', branchId);
  }

  const [
    todaySalesResult,
    monthSalesResult,
    channelSalesResult,
    recentOrdersResult,
    lowInventoryResult,
    branchesResult,
    onlineOrdersResult,
    monthPurchaseResult,
    monthReturnResult,
    pendingPOResult,
  ] = await Promise.all([
    salesQuery,
    monthSalesQuery,
    supabase
      .from('sales_orders')
      .select('channel, total_amount')
      .gte('ordered_at', `${monthStart}T00:00:00`),
    recentOrdersQuery,
    supabase
      .from('inventories')
      .select('id, quantity, safety_stock, product:products(name), branch:branches(id, name)')
      .lt('quantity', 10)
      .limit(20),
    supabase.from('branches').select('id, name'),
    supabase
      .from('sales_orders')
      .select('total_amount')
      .eq('channel', 'ONLINE')
      .gte('ordered_at', `${today}T00:00:00`)
      .lt('ordered_at', `${today}T23:59:59`),
    // 이번달 매입액 (확정 이상)
    supabase
      .from('purchase_orders')
      .select('total_amount')
      .in('status', ['CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED'])
      .gte('ordered_at', `${monthStart}T00:00:00`),
    // 이번달 환불액
    supabase
      .from('return_orders')
      .select('refund_amount')
      .eq('status', 'COMPLETED')
      .gte('processed_at', `${monthStart}T00:00:00`),
    // 진행중 발주 건수
    supabase
      .from('purchase_orders')
      .select('id', { count: 'exact', head: true })
      .in('status', ['DRAFT', 'CONFIRMED', 'PARTIALLY_RECEIVED']),
  ]);

  const todaySales = (todaySalesResult.data || []) as { total_amount: number }[];
  const monthSales = (monthSalesResult.data || []) as { total_amount: number }[];
  const channelSalesRaw = channelSalesResult.data || [];
  const recentOrders = recentOrdersResult.data || [];
  const lowInventory = (lowInventoryResult.data || []) as any[];
  const branches = (branchesResult.data || []) as { id: string; name: string }[];
  const onlineOrders = onlineOrdersResult.data || [];
  const monthPurchaseTotal = (monthPurchaseResult.data || []).reduce((s: number, p: any) => s + (p.total_amount || 0), 0);
  const monthReturnTotal   = (monthReturnResult.data || []).reduce((s: number, r: any) => s + (r.refund_amount || 0), 0);
  const pendingPOCount     = pendingPOResult.count ?? 0;

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
    const branchId = (inv.branch as any)?.id;
    if (branchId && branchInventoryMap.has(branchId)) {
      const current = branchInventoryMap.get(branchId)!;
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

  const todayTotal = todaySales.reduce((sum, o) => sum + (o.total_amount || 0), 0);
  const todayCount = todaySales.length;
  const monthTotal = monthSales.reduce((sum, o) => sum + (o.total_amount || 0), 0);
  const monthCount = monthSales.length;
  const onlineAmount = onlineOrders.reduce((sum: number, o: any) => sum + (o.total_amount || 0), 0);

  return NextResponse.json({
    todayTotal,
    todayCount,
    monthTotal,
    monthCount,
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
