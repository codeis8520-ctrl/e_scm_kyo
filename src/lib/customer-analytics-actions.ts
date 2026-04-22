'use server';

import { createClient } from '@/lib/supabase/server';
import { SEGMENT_META, type RfmSegment } from '@/lib/customer-analytics-types';
import { kstDaysAgoStart } from '@/lib/date';

// ─── RFM 스코어링 기준 ─────────────────────────────────────────────────────────

function scoreRecency(daysSinceLast: number): number {
  if (daysSinceLast <= 30)  return 5;
  if (daysSinceLast <= 60)  return 4;
  if (daysSinceLast <= 90)  return 3;
  if (daysSinceLast <= 180) return 2;
  return 1;
}

function scoreFrequency(orderCount: number): number {
  if (orderCount > 10) return 5;
  if (orderCount >= 7) return 4;
  if (orderCount >= 4) return 3;
  if (orderCount >= 2) return 2;
  return 1;
}

function scoreMonetary(totalAmount: number): number {
  if (totalAmount >= 3_000_000) return 5;
  if (totalAmount >= 1_000_000) return 4;
  if (totalAmount >= 300_000)   return 3;
  if (totalAmount >= 100_000)   return 2;
  return 1;
}

function getSegment(r: number, f: number, m: number): RfmSegment {
  if (r >= 4 && f >= 4 && m >= 4) return 'champions';
  if (r >= 3 && f >= 3 && m >= 3) return 'loyal';
  if (r >= 3 && f <= 2)            return 'new';
  if (r <= 2 && f >= 3 && m >= 3)  return 'cant_lose';
  if (r <= 2 && f >= 2)            return 'at_risk';
  if (r >= 3 && f >= 2 && m >= 2)  return 'potential_loyal';
  return 'lost';
}

// ─── RFM 전체 분석 ────────────────────────────────────────────────────────────

export async function getRfmAnalysis(branchId?: string) {
  const sb = await createClient() as any;
  const now = new Date();

  // 활성 고객 전체
  const { data: customers } = await sb
    .from('customers')
    .select('id, name, phone, grade')
    .eq('is_active', true);

  if (!customers?.length) return { data: [], segmentSummary: [] };

  // 모든 완료 주문 (고객 연결된 것만)
  let ordersQ = sb
    .from('sales_orders')
    .select('customer_id, total_amount, ordered_at, branch_id')
    .eq('status', 'COMPLETED')
    .not('customer_id', 'is', null);
  if (branchId) ordersQ = ordersQ.eq('branch_id', branchId);
  const { data: orders } = await ordersQ;

  // 고객별 집계
  const orderMap = new Map<string, { totalAmount: number; count: number; lastDate: string; firstDate: string }>();
  for (const o of (orders || [])) {
    const existing = orderMap.get(o.customer_id);
    if (!existing) {
      orderMap.set(o.customer_id, { totalAmount: o.total_amount, count: 1, lastDate: o.ordered_at, firstDate: o.ordered_at });
    } else {
      existing.totalAmount += o.total_amount;
      existing.count += 1;
      if (o.ordered_at > existing.lastDate)  existing.lastDate  = o.ordered_at;
      if (o.ordered_at < existing.firstDate) existing.firstDate = o.ordered_at;
    }
  }

  const result = customers.map((c: any) => {
    const stats = orderMap.get(c.id);
    if (!stats) {
      return { ...c, r: 0, f: 0, m: 0, segment: 'lost' as RfmSegment, daysSinceLast: null, orderCount: 0, totalAmount: 0 };
    }
    const daysSinceLast = Math.floor((now.getTime() - new Date(stats.lastDate).getTime()) / (1000 * 60 * 60 * 24));
    const r = scoreRecency(daysSinceLast);
    const f = scoreFrequency(stats.count);
    const m = scoreMonetary(stats.totalAmount);
    return {
      id: c.id, name: c.name, phone: c.phone, grade: c.grade,
      r, f, m,
      segment: getSegment(r, f, m) as RfmSegment,
      daysSinceLast,
      orderCount: stats.count,
      totalAmount: stats.totalAmount,
      lastDate: stats.lastDate,
    };
  });

  // 세그먼트 요약
  const segCountMap = new Map<string, number>();
  for (const row of result) {
    segCountMap.set(row.segment, (segCountMap.get(row.segment) || 0) + 1);
  }
  const segmentSummary = (Object.keys(SEGMENT_META) as RfmSegment[]).map(key => ({
    segment: key,
    count: segCountMap.get(key) || 0,
    ...SEGMENT_META[key],
  }));

  return { data: result, segmentSummary };
}

// ─── 재구매 주기 분석 ─────────────────────────────────────────────────────────

export async function getRepurchaseCycles(branchId?: string) {
  const sb = await createClient() as any;

  let q = sb
    .from('sales_orders')
    .select('customer_id, ordered_at')
    .eq('status', 'COMPLETED')
    .not('customer_id', 'is', null)
    .order('customer_id')
    .order('ordered_at', { ascending: true });
  if (branchId) q = q.eq('branch_id', branchId);
  const { data: orders } = await q;

  // 고객별 주문 날짜 배열
  const customerOrders = new Map<string, string[]>();
  for (const o of (orders || [])) {
    const existing = customerOrders.get(o.customer_id) || [];
    existing.push(o.ordered_at);
    customerOrders.set(o.customer_id, existing);
  }

  // 재구매 간격 계산 (2건 이상 구매한 고객만)
  const intervals: number[] = [];
  const customerCycles: { customerId: string; avgDays: number; orderCount: number }[] = [];

  for (const [customerId, dates] of customerOrders.entries()) {
    if (dates.length < 2) continue;
    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      const days = Math.floor(
        (new Date(dates[i]).getTime() - new Date(dates[i - 1]).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (days > 0) { gaps.push(days); intervals.push(days); }
    }
    if (gaps.length) {
      customerCycles.push({
        customerId,
        avgDays: Math.round(gaps.reduce((s, d) => s + d, 0) / gaps.length),
        orderCount: dates.length,
      });
    }
  }

  const avgCycle = intervals.length
    ? Math.round(intervals.reduce((s, d) => s + d, 0) / intervals.length)
    : 0;

  // 구간별 분포
  const distribution = [
    { label: '7일 이하',    min: 0,   max: 7   },
    { label: '8~30일',      min: 8,   max: 30  },
    { label: '31~60일',     min: 31,  max: 60  },
    { label: '61~90일',     min: 61,  max: 90  },
    { label: '91~180일',    min: 91,  max: 180 },
    { label: '180일 초과',  min: 181, max: Infinity },
  ].map(bucket => ({
    label: bucket.label,
    count: intervals.filter(d => d >= bucket.min && d <= bucket.max).length,
  }));

  return {
    avgCycleDays: avgCycle,
    repeatCustomerCount: customerCycles.length,
    distribution,
    topShortCycle: customerCycles.sort((a, b) => a.avgDays - b.avgDays).slice(0, 10),
  };
}

// ─── 이탈 위험 고객 (최근 60일 이상 미구매, 2회 이상 구매 이력) ────────────────

export async function getChurnRiskCustomers(branchId?: string) {
  const sb = await createClient() as any;
  // KST 기준 60일 전 자정
  const cutoff = kstDaysAgoStart(60);

  let q = sb
    .from('sales_orders')
    .select('customer_id, ordered_at, total_amount')
    .eq('status', 'COMPLETED')
    .not('customer_id', 'is', null);
  if (branchId) q = q.eq('branch_id', branchId);
  const { data: orders } = await q;

  // 고객별 마지막 구매일 & 구매 횟수 & LTV
  const customerMap = new Map<string, { lastDate: string; count: number; totalAmount: number }>();
  for (const o of (orders || [])) {
    const e = customerMap.get(o.customer_id);
    if (!e) {
      customerMap.set(o.customer_id, { lastDate: o.ordered_at, count: 1, totalAmount: o.total_amount });
    } else {
      e.count++;
      e.totalAmount += o.total_amount;
      if (o.ordered_at > e.lastDate) e.lastDate = o.ordered_at;
    }
  }

  // 이탈 위험 필터: 마지막 구매 > 60일 전 & 구매 횟수 >= 2
  const atRisk = Array.from(customerMap.entries())
    .filter(([, v]) => v.lastDate < cutoff && v.count >= 2)
    .map(([customerId, v]) => ({
      customerId,
      lastDate: v.lastDate,
      orderCount: v.count,
      totalAmount: v.totalAmount,
      daysSinceLast: Math.floor((Date.now() - new Date(v.lastDate).getTime()) / (1000 * 60 * 60 * 24)),
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, 50);

  if (!atRisk.length) return { data: [] };

  // 고객 이름/연락처 조회
  const ids = atRisk.map(r => r.customerId);
  const { data: customerRows } = await sb
    .from('customers')
    .select('id, name, phone, grade')
    .in('id', ids);

  const nameMap = new Map((customerRows || []).map((c: any) => [c.id, c]));

  return {
    data: atRisk.map(r => ({
      ...r,
      name:  (nameMap.get(r.customerId) as any)?.name  || '알 수 없음',
      phone: (nameMap.get(r.customerId) as any)?.phone || '-',
      grade: (nameMap.get(r.customerId) as any)?.grade || '-',
    })),
  };
}
