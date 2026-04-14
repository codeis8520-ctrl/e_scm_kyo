import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

const FIELD_LABELS: Record<string, string> = {
  name: '이름',
  phone: '연락처',
  email: '이메일',
  address: '주소',
  product: '구매제품',
};

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const searchParams = request.nextUrl.searchParams;
  const q = (searchParams.get('q') || '').trim();
  const grade = searchParams.get('grade') || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(100, parseInt(searchParams.get('limit') || '30'));

  const cookieStore = await cookies();
  const userRole = cookieStore.get('user_role')?.value;
  const userBranchId = cookieStore.get('user_branch_id')?.value;
  const isBranchUser = userRole === 'BRANCH_STAFF' || userRole === 'PHARMACY_STAFF';
  const branchId = isBranchUser ? userBranchId : null;

  // 검색어 없으면 기본 목록 반환
  if (!q) {
    return await fetchDefaultList(supabase, grade, branchId, page, limit);
  }

  // RPC 사용 시도 (마이그레이션 040 적용 후)
  try {
    const { data, error } = await (supabase as any).rpc('search_customers_full', {
      search_query: q,
      grade_filter: grade || null,
      branch_filter: branchId || null,
      page_offset: (page - 1) * limit,
      page_limit: limit,
    });

    if (!error && data) {
      // RPC 결과에 label 추가
      const customers = (data.customers || []).map((c: any) => ({
        ...c,
        match_reasons: (c.match_reasons || []).map((r: any) => ({
          ...r,
          label: `${FIELD_LABELS[r.field] || r.field}: ${r.value}`,
        })),
      }));
      return NextResponse.json({ customers, total: data.total, page: data.page });
    }

    // RPC 없으면 (마이그레이션 미적용) 폴백
    if (error?.code === '42883') {
      return await fallbackSearch(supabase, q, grade, branchId, page, limit);
    }

    // 기타 에러
    console.error('search_customers_full RPC error:', error);
    return await fallbackSearch(supabase, q, grade, branchId, page, limit);
  } catch {
    return await fallbackSearch(supabase, q, grade, branchId, page, limit);
  }
}

// 검색어 없을 때 기본 목록
async function fetchDefaultList(
  supabase: any, grade: string, branchId: string | null | undefined, page: number, limit: number
) {
  let query = supabase
    .from('customers')
    .select('id, name, phone, email, address, grade, is_active, primary_branch:branches(id, name)', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (grade) query = query.eq('grade', grade);
  if (branchId) query = query.eq('primary_branch_id', branchId);
  query = query.range((page - 1) * limit, page * limit - 1);

  const { data, count } = await query;
  const customers = await attachPoints(supabase, data || []);
  return NextResponse.json({
    customers: customers.map((c: any) => ({ ...c, match_reasons: [] })),
    total: count || 0,
    page,
  });
}

// RPC 미적용 시 폴백 (다중 쿼리 방식)
async function fallbackSearch(
  supabase: any, q: string, grade: string, branchId: string | null | undefined, page: number, limit: number
) {
  const digitsOnly = q.replace(/[^0-9]/g, '');
  const isPhoneSearch = digitsOnly.length >= 3;

  const [directResults, productCustomerIds] = await Promise.all([
    (async () => {
      const orFilters = [
        `name.ilike.%${q}%`,
        `email.ilike.%${q}%`,
        `address.ilike.%${q}%`,
        `phone.ilike.%${q}%`,
      ];
      if (isPhoneSearch && digitsOnly !== q) orFilters.push(`phone.ilike.%${digitsOnly}%`);

      let query = supabase
        .from('customers')
        .select('id, name, phone, email, address, grade, is_active, primary_branch:branches(id, name)')
        .or(orFilters.join(','));

      if (grade) query = query.eq('grade', grade);
      if (branchId) query = query.eq('primary_branch_id', branchId);
      const { data } = await query;
      return (data || []) as any[];
    })(),
    (async () => {
      const { data: products } = await supabase
        .from('products').select('id, name').ilike('name', `%${q}%`).limit(50);
      if (!products?.length) return new Map<string, string>();

      const productIds = products.map((p: any) => p.id);
      const productNameMap = new Map<string, string>(products.map((p: any) => [p.id, p.name]));

      const { data: orderItems } = await supabase
        .from('sales_order_items').select('sales_order_id, product_id').in('product_id', productIds).limit(500);
      if (!orderItems?.length) return new Map<string, string>();

      const orderIds = [...new Set((orderItems as any[]).map((i: any) => i.sales_order_id))];
      const orderProductMap = new Map<string, string>();
      for (const item of orderItems as any[]) {
        const pName = productNameMap.get(item.product_id);
        if (pName) orderProductMap.set(item.sales_order_id, pName);
      }

      const { data: orders } = await supabase
        .from('sales_orders').select('id, customer_id').in('id', orderIds.slice(0, 200)).not('customer_id', 'is', null);

      const map = new Map<string, string>();
      for (const o of (orders || []) as any[]) {
        if (o.customer_id && !map.has(o.customer_id)) map.set(o.customer_id, orderProductMap.get(o.id) || q);
      }
      return map;
    })(),
  ]);

  const customerMap = new Map<string, { customer: any; reasons: any[] }>();
  const ql = q.toLowerCase();

  for (const c of directResults) {
    const reasons: any[] = [];
    if (c.name?.toLowerCase().includes(ql)) reasons.push({ field: 'name', value: c.name });
    if (c.phone?.includes(q) || (isPhoneSearch && c.phone?.replace(/[^0-9]/g, '').includes(digitsOnly)))
      reasons.push({ field: 'phone', value: c.phone });
    if (c.email?.toLowerCase().includes(ql)) reasons.push({ field: 'email', value: c.email });
    if (c.address?.toLowerCase().includes(ql))
      reasons.push({ field: 'address', value: c.address.length > 30 ? c.address.substring(0, 30) + '...' : c.address });
    customerMap.set(c.id, { customer: c, reasons });
  }

  for (const [customerId, productName] of productCustomerIds) {
    if (customerMap.has(customerId)) {
      customerMap.get(customerId)!.reasons.push({ field: 'product', value: productName });
    }
  }

  const productOnlyIds = [...productCustomerIds.keys()].filter(id => !customerMap.has(id));
  if (productOnlyIds.length > 0) {
    let query = supabase
      .from('customers')
      .select('id, name, phone, email, address, grade, is_active, primary_branch:branches(id, name)')
      .in('id', productOnlyIds.slice(0, 100));
    if (grade) query = query.eq('grade', grade);
    if (branchId) query = query.eq('primary_branch_id', branchId);
    const { data } = await query;
    for (const c of (data || []) as any[]) {
      customerMap.set(c.id, {
        customer: c,
        reasons: [{ field: 'product', value: productCustomerIds.get(c.id) || q }],
      });
    }
  }

  const allResults = [...customerMap.values()].filter(({ customer }) => !grade || customer.grade === grade);
  const total = allResults.length;
  const startIdx = (page - 1) * limit;
  const pageResults = allResults.slice(startIdx, startIdx + limit);
  const customers = await attachPoints(supabase, pageResults.map(r => r.customer));

  const response = customers.map((c: any) => ({
    ...c,
    match_reasons: (customerMap.get(c.id)?.reasons || []).map((r: any) => ({
      ...r,
      label: `${FIELD_LABELS[r.field] || r.field}: ${r.value}`,
    })),
  }));

  return NextResponse.json({ customers: response, total, page });
}

async function attachPoints(supabase: any, customers: any[]): Promise<any[]> {
  if (customers.length === 0) return [];
  const ids = customers.map((c: any) => c.id);
  const { data: pointRows } = await supabase
    .from('point_history').select('customer_id, balance').in('customer_id', ids).order('created_at', { ascending: false });

  const balanceMap: Record<string, number> = {};
  for (const row of (pointRows || []) as any[]) {
    if (!(row.customer_id in balanceMap)) balanceMap[row.customer_id] = row.balance;
  }
  return customers.map((c: any) => ({ ...c, total_points: balanceMap[c.id] ?? 0 }));
}
