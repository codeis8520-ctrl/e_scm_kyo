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

type SortKey = 'recent' | 'recent_consult' | 'recent_purchase' | 'name';

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const searchParams = request.nextUrl.searchParams;
  const q = (searchParams.get('q') || '').trim();
  const grade = searchParams.get('grade') || '';
  const hasConsult = searchParams.get('hasConsult') === '1';
  const sort = (searchParams.get('sort') || 'recent') as SortKey;
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(100, parseInt(searchParams.get('limit') || '30'));

  const cookieStore = await cookies();
  const userRole = cookieStore.get('user_role')?.value;
  const userBranchId = cookieStore.get('user_branch_id')?.value;
  const isBranchUser = userRole === 'BRANCH_STAFF' || userRole === 'PHARMACY_STAFF';
  const branchId = isBranchUser ? userBranchId : null;

  // 검색어 없으면 기본 목록 반환
  if (!q) {
    return await fetchDefaultList(supabase, grade, branchId, page, limit, hasConsult, sort);
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
      let customers = (data.customers || []).map((c: any) => ({
        ...c,
        match_reasons: (c.match_reasons || []).map((r: any) => ({
          ...r,
          label: `${FIELD_LABELS[r.field] || r.field}: ${r.value}`,
        })),
      }));
      customers = await attachHistory(supabase, customers);
      customers = postFilterAndSort(customers, hasConsult, sort);
      return NextResponse.json({ customers, total: data.total, page: data.page });
    }

    if (error?.code === '42883') {
      return await fallbackSearch(supabase, q, grade, branchId, page, limit, hasConsult, sort);
    }

    console.error('search_customers_full RPC error:', error);
    return await fallbackSearch(supabase, q, grade, branchId, page, limit, hasConsult, sort);
  } catch {
    return await fallbackSearch(supabase, q, grade, branchId, page, limit, hasConsult, sort);
  }
}

// 검색어 없을 때 기본 목록
async function fetchDefaultList(
  supabase: any, grade: string, branchId: string | null | undefined,
  page: number, limit: number, hasConsult: boolean, sort: SortKey,
) {
  // hasConsult 필터 활성 시: 상담 기록이 있는 customer_id 먼저 구하고 in 필터
  let allowedIds: string[] | null = null;
  if (hasConsult) {
    const { data } = await supabase
      .from('customer_consultations')
      .select('customer_id')
      .order('created_at', { ascending: false })
      .limit(5000);
    allowedIds = [...new Set(((data || []) as any[]).map((r: any) => r.customer_id))];
    if (allowedIds!.length === 0) {
      return NextResponse.json({ customers: [], total: 0, page });
    }
  }

  // 정렬이 상담/구매 기준이면 전체 후보를 가져와 JS에서 정렬 (페이지 적용 전)
  const needsHistorySort = sort === 'recent_consult' || sort === 'recent_purchase';

  let query = supabase
    .from('customers')
    .select('id, name, phone, email, address, grade, is_active, primary_branch:branches(id, name), assigned_to:users!customers_assigned_to_fkey(id, name)', { count: 'exact' });

  if (!needsHistorySort) {
    if (sort === 'name') query = query.order('name', { ascending: true });
    else query = query.order('created_at', { ascending: false });
  }

  if (grade) query = query.eq('grade', grade);
  if (branchId) query = query.eq('primary_branch_id', branchId);
  if (allowedIds) query = query.in('id', allowedIds);

  if (!needsHistorySort) {
    query = query.range((page - 1) * limit, page * limit - 1);
  } else {
    // 과도한 로드 방지: 최대 1000명까지만 대상으로 정렬
    query = query.range(0, 999);
  }

  const { data, count } = await query;
  let rows = await attachPoints(supabase, data || []);
  rows = await attachHistory(supabase, rows);
  rows = rows.map((c: any) => ({ ...c, match_reasons: [] }));

  if (needsHistorySort) {
    rows = sortByHistory(rows, sort);
    const total = rows.length;
    const startIdx = (page - 1) * limit;
    return NextResponse.json({
      customers: rows.slice(startIdx, startIdx + limit),
      total,
      page,
    });
  }

  return NextResponse.json({
    customers: rows,
    total: count || 0,
    page,
  });
}

// RPC 미적용 시 폴백 (다중 쿼리 방식)
async function fallbackSearch(
  supabase: any, q: string, grade: string, branchId: string | null | undefined,
  page: number, limit: number, hasConsult: boolean, sort: SortKey,
) {
  const digitsOnly = q.replace(/[^0-9]/g, '');
  const isPhoneSearch = digitsOnly.length >= 3;

  // 전화번호 검색 정규화 — 저장은 010-XXXX-XXXX 형식이라
  // 사용자가 01012345678 처럼 입력하면 그냥 ilike '%01012345678%' 로는 안 잡힘.
  // 11자리 digits → 분할 패턴(010-XXXX-XXXX) 도 시도.
  const phonePatterns: string[] = [];
  if (isPhoneSearch) {
    phonePatterns.push(digitsOnly);
    if (digitsOnly.length === 11) {
      phonePatterns.push(`${digitsOnly.slice(0,3)}-${digitsOnly.slice(3,7)}-${digitsOnly.slice(7)}`);
    } else if (digitsOnly.length === 10) {
      phonePatterns.push(`${digitsOnly.slice(0,3)}-${digitsOnly.slice(3,6)}-${digitsOnly.slice(6)}`);
    } else if (digitsOnly.length >= 4) {
      // 부분 검색 — 뒷자리 4자리 기준 매칭
      phonePatterns.push(digitsOnly.slice(-4));
    }
  }

  // PostgREST .or() 내부 ilike 값은 (), , " 를 escape 위해 큰따옴표로 감싸야 안전.
  const sQ = q.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const [directResults, productCustomerIds] = await Promise.all([
    (async () => {
      const orFilters = [
        `name.ilike."%${sQ}%"`,
        `email.ilike."%${sQ}%"`,
        `address.ilike."%${sQ}%"`,
        `phone.ilike."%${sQ}%"`,
      ];
      for (const p of phonePatterns) {
        const sp = p.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        orFilters.push(`phone.ilike."%${sp}%"`);
      }

      let query = supabase
        .from('customers')
        .select('id, name, phone, email, address, grade, is_active, primary_branch:branches(id, name), assigned_to:users!customers_assigned_to_fkey(id, name)')
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
      .select('id, name, phone, email, address, grade, is_active, primary_branch:branches(id, name), assigned_to:users!customers_assigned_to_fkey(id, name)')
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

  let allResults = [...customerMap.values()].filter(({ customer }) => !grade || customer.grade === grade);
  let customers = await attachPoints(supabase, allResults.map(r => r.customer));
  customers = await attachHistory(supabase, customers);
  customers = customers.map((c: any) => ({
    ...c,
    match_reasons: (customerMap.get(c.id)?.reasons || []).map((r: any) => ({
      ...r,
      label: `${FIELD_LABELS[r.field] || r.field}: ${r.value}`,
    })),
  }));
  customers = postFilterAndSort(customers, hasConsult, sort);

  const total = customers.length;
  const startIdx = (page - 1) * limit;
  return NextResponse.json({ customers: customers.slice(startIdx, startIdx + limit), total, page });
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

function extractSnippet(content: any): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  const text = content.text || content.summary || content.note;
  if (typeof text === 'string') return text;
  try { return JSON.stringify(content); } catch { return ''; }
}

// 상담 요약(최근 1건 + 총 건수) + 최근 구매일 부착
async function attachHistory(supabase: any, customers: any[]): Promise<any[]> {
  if (customers.length === 0) return [];
  const ids = customers.map((c: any) => c.id);

  const [consultRes, consultCountRes, orderRes, legacyRes] = await Promise.all([
    supabase
      .from('customer_consultations')
      .select('customer_id, consultation_type, content, created_at, consulted_by:users(name)')
      .in('customer_id', ids)
      .order('created_at', { ascending: false })
      .limit(ids.length * 5),
    supabase
      .from('customer_consultations')
      .select('customer_id')
      .in('customer_id', ids),
    supabase
      .from('sales_orders')
      .select('customer_id, ordered_at, total_amount, status')
      .in('customer_id', ids)
      .order('ordered_at', { ascending: false })
      .limit(ids.length * 3),
    // 과거 구매(legacy) — 최근 N건씩만, 1000행 제한 우회
    supabase
      .from('legacy_purchases')
      .select('customer_id, ordered_at, total_amount')
      .in('customer_id', ids)
      .order('ordered_at', { ascending: false })
      .range(0, Math.max(99, ids.length * 5)),
  ]);

  const latestConsult: Record<string, any> = {};
  for (const row of (consultRes.data || []) as any[]) {
    if (!(row.customer_id in latestConsult)) {
      latestConsult[row.customer_id] = {
        type: row.consultation_type,
        snippet: extractSnippet(row.content).slice(0, 80),
        created_at: row.created_at,
        consultant_name: row.consulted_by?.name || null,
      };
    }
  }

  const consultCount: Record<string, number> = {};
  for (const row of (consultCountRes.data || []) as any[]) {
    consultCount[row.customer_id] = (consultCount[row.customer_id] || 0) + 1;
  }

  const latestPurchase: Record<string, { ordered_at: string; total_amount: number; source?: 'sales' | 'legacy' }> = {};
  for (const row of (orderRes.data || []) as any[]) {
    if (['CANCELLED', 'REFUNDED'].includes(row.status)) continue;
    if (!(row.customer_id in latestPurchase)) {
      latestPurchase[row.customer_id] = { ordered_at: row.ordered_at, total_amount: row.total_amount, source: 'sales' };
    }
  }
  // legacy 더 최근이면 갈아치움 (둘 다 ordered_at 비교)
  for (const row of (legacyRes.data || []) as any[]) {
    const existing = latestPurchase[row.customer_id];
    const lpDate = String(row.ordered_at);
    if (!existing || lpDate > existing.ordered_at) {
      latestPurchase[row.customer_id] = { ordered_at: lpDate, total_amount: Number(row.total_amount) || 0, source: 'legacy' };
    }
  }
  // legacy 건수도 별도 집계
  const legacyCount: Record<string, number> = {};
  for (const row of (legacyRes.data || []) as any[]) {
    legacyCount[row.customer_id] = (legacyCount[row.customer_id] || 0) + 1;
  }

  return customers.map((c: any) => ({
    ...c,
    last_consultation: latestConsult[c.id] || null,
    consultation_count: consultCount[c.id] || 0,
    last_purchase_at: latestPurchase[c.id]?.ordered_at || null,
    last_purchase_amount: latestPurchase[c.id]?.total_amount ?? null,
    last_purchase_source: latestPurchase[c.id]?.source || null,
    legacy_purchase_count: legacyCount[c.id] || 0,
  }));
}

function postFilterAndSort(customers: any[], hasConsult: boolean, sort: SortKey): any[] {
  let out = customers;
  if (hasConsult) out = out.filter((c) => (c.consultation_count || 0) > 0);
  return sortByHistory(out, sort);
}

function sortByHistory(customers: any[], sort: SortKey): any[] {
  if (sort === 'recent_consult') {
    return [...customers].sort((a, b) => {
      const av = a.last_consultation?.created_at || '';
      const bv = b.last_consultation?.created_at || '';
      return bv.localeCompare(av);
    });
  }
  if (sort === 'recent_purchase') {
    return [...customers].sort((a, b) => {
      const av = a.last_purchase_at || '';
      const bv = b.last_purchase_at || '';
      return bv.localeCompare(av);
    });
  }
  if (sort === 'name') {
    return [...customers].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
  }
  return customers; // 기본(등록일 역순)은 SQL에서 이미 정렬
}
