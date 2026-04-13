import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

interface MatchReason {
  field: string;
  value: string;
}

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

  // 검색어 없으면 기본 목록 반환
  if (!q) {
    let query = supabase
      .from('customers')
      .select('id, name, phone, email, address, grade, is_active, primary_branch:branches(id, name)', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (grade) query = query.eq('grade', grade);
    if (isBranchUser && userBranchId) query = query.eq('primary_branch_id', userBranchId);

    query = query.range((page - 1) * limit, page * limit - 1);
    const { data, count } = await query;

    const customers = await attachPoints(supabase, data || []);

    return NextResponse.json({
      customers: customers.map((c: any) => ({ ...c, match_reasons: [] })),
      total: count || 0,
      page,
    });
  }

  // 전화번호 검색용: 숫자만 추출
  const digitsOnly = q.replace(/[^0-9]/g, '');
  const isPhoneSearch = digitsOnly.length >= 3;

  // === 병렬 검색 ===
  const [directResults, productCustomerIds] = await Promise.all([
    // 1. 직접 필드 검색 (name, phone, email, address)
    (async () => {
      const orFilters = [
        `name.ilike.%${q}%`,
        `email.ilike.%${q}%`,
        `address.ilike.%${q}%`,
      ];
      // phone 검색: 원본 + 숫자만 추출 패턴 모두 시도
      orFilters.push(`phone.ilike.%${q}%`);
      if (isPhoneSearch && digitsOnly !== q) {
        orFilters.push(`phone.ilike.%${digitsOnly}%`);
      }

      let query = supabase
        .from('customers')
        .select('id, name, phone, email, address, grade, is_active, primary_branch:branches(id, name)')
        .or(orFilters.join(','));

      if (grade) query = query.eq('grade', grade);
      if (isBranchUser && userBranchId) query = query.eq('primary_branch_id', userBranchId);

      const { data } = await query;
      return data || [];
    })(),

    // 2. 구매 제품 검색: products → sales_order_items → sales_orders.customer_id
    (async () => {
      // Step A: 매칭 제품 ID
      const { data: products } = await supabase
        .from('products')
        .select('id, name')
        .ilike('name', `%${q}%`)
        .limit(50);

      if (!products || products.length === 0) return new Map<string, string>();

      const productIds = products.map((p: any) => p.id);
      const productNameMap = new Map(products.map((p: any) => [p.id, p.name]));

      // Step B: 해당 제품이 포함된 주문
      const { data: orderItems } = await supabase
        .from('sales_order_items')
        .select('sales_order_id, product_id')
        .in('product_id', productIds)
        .limit(500);

      if (!orderItems || orderItems.length === 0) return new Map<string, string>();

      const orderIds = [...new Set(orderItems.map((i: any) => i.sales_order_id))];
      // product_id → order_id 매핑 (나중에 customer에 제품명 매칭용)
      const orderProductMap = new Map<string, string>();
      for (const item of orderItems as any[]) {
        const pName = productNameMap.get(item.product_id);
        if (pName) orderProductMap.set(item.sales_order_id, pName);
      }

      // Step C: 주문의 customer_id
      const { data: orders } = await supabase
        .from('sales_orders')
        .select('id, customer_id')
        .in('id', orderIds.slice(0, 200))
        .not('customer_id', 'is', null);

      if (!orders) return new Map<string, string>();

      const customerProductMap = new Map<string, string>();
      for (const order of orders as any[]) {
        if (order.customer_id && !customerProductMap.has(order.customer_id)) {
          customerProductMap.set(order.customer_id, orderProductMap.get(order.id) || q);
        }
      }
      return customerProductMap;
    })(),
  ]);

  // === 결과 병합 ===
  const customerMap = new Map<string, { customer: any; reasons: MatchReason[] }>();

  // 직접 필드 매칭 결과
  for (const c of directResults as any[]) {
    const reasons: MatchReason[] = [];
    const ql = q.toLowerCase();

    if (c.name?.toLowerCase().includes(ql)) {
      reasons.push({ field: 'name', value: c.name });
    }
    if (c.phone?.includes(q) || (isPhoneSearch && c.phone?.replace(/[^0-9]/g, '').includes(digitsOnly))) {
      reasons.push({ field: 'phone', value: c.phone });
    }
    if (c.email?.toLowerCase().includes(ql)) {
      reasons.push({ field: 'email', value: c.email });
    }
    if (c.address?.toLowerCase().includes(ql)) {
      const addr = c.address.length > 30 ? c.address.substring(0, 30) + '...' : c.address;
      reasons.push({ field: 'address', value: addr });
    }

    customerMap.set(c.id, { customer: c, reasons });
  }

  // 제품 매칭 결과 병합
  for (const [customerId, productName] of productCustomerIds) {
    if (customerMap.has(customerId)) {
      // 이미 직접 필드에서 찾은 고객 → 제품 매칭 사유 추가
      customerMap.get(customerId)!.reasons.push({ field: 'product', value: productName });
    } else {
      // 제품으로만 찾은 고객 → 고객 정보 조회 필요
      // 나중에 일괄 조회
    }
  }

  // 제품 매칭으로만 찾은 고객 일괄 조회
  const productOnlyIds = [...productCustomerIds.keys()].filter((id) => !customerMap.has(id));
  if (productOnlyIds.length > 0) {
    let query = supabase
      .from('customers')
      .select('id, name, phone, email, address, grade, is_active, primary_branch:branches(id, name)')
      .in('id', productOnlyIds.slice(0, 100));

    if (grade) query = query.eq('grade', grade);
    if (isBranchUser && userBranchId) query = query.eq('primary_branch_id', userBranchId);

    const { data } = await query;
    for (const c of (data || []) as any[]) {
      const productName = productCustomerIds.get(c.id) || q;
      customerMap.set(c.id, {
        customer: c,
        reasons: [{ field: 'product', value: productName }],
      });
    }
  }

  // 등급 필터 적용 (직접 필드 검색에서 이미 적용되지만, 제품 매칭 결과에도 적용)
  const allResults = [...customerMap.values()]
    .filter(({ customer }) => !grade || customer.grade === grade);

  const total = allResults.length;

  // 페이지네이션
  const startIdx = (page - 1) * limit;
  const pageResults = allResults.slice(startIdx, startIdx + limit);

  // 포인트 첨부
  const customers = await attachPoints(
    supabase,
    pageResults.map((r) => r.customer)
  );

  const response = customers.map((c: any) => {
    const entry = customerMap.get(c.id);
    return {
      ...c,
      match_reasons: entry?.reasons.map((r) => ({
        ...r,
        label: `${FIELD_LABELS[r.field] || r.field}: ${r.value}`,
      })) || [],
    };
  });

  return NextResponse.json({ customers: response, total, page });
}

async function attachPoints(supabase: any, customers: any[]): Promise<any[]> {
  if (customers.length === 0) return [];

  const ids = customers.map((c: any) => c.id);
  const { data: pointRows } = await supabase
    .from('point_history')
    .select('customer_id, balance')
    .in('customer_id', ids)
    .order('created_at', { ascending: false });

  const balanceMap: Record<string, number> = {};
  for (const row of (pointRows || []) as any[]) {
    if (!(row.customer_id in balanceMap)) {
      balanceMap[row.customer_id] = row.balance;
    }
  }

  return customers.map((c: any) => ({
    ...c,
    total_points: balanceMap[c.id] ?? 0,
  }));
}
