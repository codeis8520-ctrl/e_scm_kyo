'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

function getUserId(): string | null {
  try {
    return (cookies() as any).get('user_id')?.value || null;
  } catch { return null; }
}

// ─── 계정과목 ─────────────────────────────────────────────────

export async function getGLAccounts() {
  const sb = await createClient();
  const { data, error } = await (sb as any)
    .from('gl_accounts')
    .select('*')
    .order('sort_order');
  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}

// ─── 분개 목록 ────────────────────────────────────────────────

export async function getJournalEntries(filters?: {
  startDate?: string;
  endDate?: string;
  sourceType?: string;
}) {
  const sb = await createClient();
  let q = (sb as any)
    .from('journal_entries')
    .select(`
      *,
      lines:journal_entry_lines(
        id, debit, credit, memo,
        account:gl_accounts(code, name, account_type)
      )
    `)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200);

  if (filters?.startDate) q = q.gte('entry_date', filters.startDate);
  if (filters?.endDate)   q = q.lte('entry_date', filters.endDate);
  if (filters?.sourceType) q = q.eq('source_type', filters.sourceType);

  const { data, error } = await q;
  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}

// ─── 총계정원장 (계정별 잔액 추이) ────────────────────────────

export async function getLedger(accountId: string, startDate?: string, endDate?: string) {
  const sb = await createClient();
  let q = (sb as any)
    .from('journal_entry_lines')
    .select(`
      id, debit, credit, memo, created_at,
      entry:journal_entries(entry_number, entry_date, description, source_type)
    `)
    .eq('account_id', accountId)
    .order('created_at', { ascending: true });

  if (startDate) q = q.gte('created_at', `${startDate}T00:00:00`);
  if (endDate)   q = q.lte('created_at', `${endDate}T23:59:59`);

  const { data, error } = await q;
  if (error) return { data: [], error: error.message };

  // 잔액 누계 계산
  let balance = 0;
  const rows = (data || []).map((row: any) => {
    balance += (row.debit || 0) - (row.credit || 0);
    return { ...row, balance };
  });
  return { data: rows };
}

// ─── 손익계산서 (운영 테이블 직접 집계) ───────────────────────

export async function getProfitLoss(startDate: string, endDate: string, branchId?: string) {
  const sb = await createClient() as any;

  const startDT = `${startDate}T00:00:00`;
  const endDT   = `${endDate}T23:59:59`;

  // 1. 매출 (완료 주문)
  let salesQ = sb
    .from('sales_orders')
    .select('total_amount, discount_amount')
    .eq('status', 'COMPLETED')
    .gte('ordered_at', startDT)
    .lte('ordered_at', endDT);
  if (branchId) salesQ = salesQ.eq('branch_id', branchId);
  const { data: salesRows } = await salesQ;

  const grossRevenue = (salesRows || []).reduce((s: number, o: any) => s + (o.total_amount || 0), 0);
  const totalDiscount = (salesRows || []).reduce((s: number, o: any) => s + (o.discount_amount || 0), 0);

  // 2. 환불 금액
  let refundQ = sb
    .from('return_orders')
    .select('refund_amount')
    .eq('status', 'COMPLETED')
    .gte('processed_at', startDT)
    .lte('processed_at', endDT);
  if (branchId) refundQ = refundQ.eq('branch_id', branchId);
  const { data: refundRows } = await refundQ;
  const totalRefunds = (refundRows || []).reduce((s: number, r: any) => s + (r.refund_amount || 0), 0);

  // 3. 매출원가 (판매 아이템 × 원가)
  let cogsQ = sb
    .from('sales_orders')
    .select(`
      id,
      items:sales_order_items(quantity, product:products(cost))
    `)
    .eq('status', 'COMPLETED')
    .gte('ordered_at', startDT)
    .lte('ordered_at', endDT);
  if (branchId) cogsQ = cogsQ.eq('branch_id', branchId);
  const { data: cogsOrders } = await cogsQ;

  let cogs = 0;
  for (const order of (cogsOrders || [])) {
    for (const item of (order.items || [])) {
      cogs += (item.product?.cost || 0) * (item.quantity || 0);
    }
  }

  // 4. 매입 (이 기간 확정/입고 발주)
  let purchaseQ = sb
    .from('purchase_orders')
    .select('total_amount, status')
    .in('status', ['CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED'])
    .gte('ordered_at', startDT)
    .lte('ordered_at', endDT);
  if (branchId) purchaseQ = purchaseQ.eq('branch_id', branchId);
  const { data: purchaseRows } = await purchaseQ;
  const totalPurchases = (purchaseRows || []).reduce((s: number, p: any) => s + (p.total_amount || 0), 0);

  const netRevenue    = grossRevenue - totalDiscount - totalRefunds;
  const grossProfit   = netRevenue - cogs;
  const grossMargin   = netRevenue > 0 ? Math.round(grossProfit / netRevenue * 100) : 0;

  return {
    grossRevenue,
    totalDiscount,
    totalRefunds,
    netRevenue,
    cogs,
    grossProfit,
    grossMargin,
    totalPurchases,
    orderCount: (salesRows || []).length,
    refundCount: (refundRows || []).length,
  };
}

// ─── 월별 트렌드 (최근 N개월) ────────────────────────────────

export async function getMonthlyTrend(months = 12, branchId?: string) {
  const sb = await createClient() as any;

  const end = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - months + 1);
  start.setDate(1);
  const startDT = `${start.toISOString().slice(0, 7)}-01T00:00:00`;
  const endDT   = `${end.toISOString().slice(0, 10)}T23:59:59`;

  // 매출 (월별)
  let salesQ = sb
    .from('sales_orders')
    .select('total_amount, discount_amount, ordered_at, items:sales_order_items(quantity, product:products(cost))')
    .eq('status', 'COMPLETED')
    .gte('ordered_at', startDT)
    .lte('ordered_at', endDT);
  if (branchId) salesQ = salesQ.eq('branch_id', branchId);
  const { data: salesRows } = await salesQ;

  // 환불 (월별)
  let refundQ = sb
    .from('return_orders')
    .select('refund_amount, processed_at')
    .eq('status', 'COMPLETED')
    .gte('processed_at', startDT)
    .lte('processed_at', endDT);
  if (branchId) refundQ = refundQ.eq('branch_id', branchId);
  const { data: refundRows } = await refundQ;

  // 월별 집계 맵 생성
  const monthMap = new Map<string, { grossRevenue: number; discount: number; refunds: number; cogs: number; orderCount: number }>();

  // 지난 N개월 키 초기화
  for (let i = 0; i < months; i++) {
    const d = new Date(end);
    d.setMonth(d.getMonth() - (months - 1 - i));
    const key = d.toISOString().slice(0, 7);
    monthMap.set(key, { grossRevenue: 0, discount: 0, refunds: 0, cogs: 0, orderCount: 0 });
  }

  for (const order of (salesRows || [])) {
    const key = (order.ordered_at as string).slice(0, 7);
    const m = monthMap.get(key);
    if (!m) continue;
    m.grossRevenue += order.total_amount || 0;
    m.discount     += order.discount_amount || 0;
    m.orderCount   += 1;
    for (const item of (order.items || [])) {
      m.cogs += (item.product?.cost || 0) * (item.quantity || 0);
    }
  }

  for (const row of (refundRows || [])) {
    const key = (row.processed_at as string).slice(0, 7);
    const m = monthMap.get(key);
    if (m) m.refunds += row.refund_amount || 0;
  }

  const result = Array.from(monthMap.entries()).map(([month, m]) => {
    const netRevenue  = m.grossRevenue - m.discount - m.refunds;
    const grossProfit = netRevenue - m.cogs;
    return {
      month,
      grossRevenue: m.grossRevenue,
      discount: m.discount,
      refunds: m.refunds,
      netRevenue,
      cogs: m.cogs,
      grossProfit,
      grossMargin: netRevenue > 0 ? Math.round(grossProfit / netRevenue * 100) : 0,
      orderCount: m.orderCount,
    };
  });

  return { data: result };
}

// ─── 제품별 마진 분석 ──────────────────────────────────────────

export async function getProductMargins(startDate: string, endDate: string, branchId?: string) {
  const sb = await createClient() as any;
  const startDT = `${startDate}T00:00:00`;
  const endDT   = `${endDate}T23:59:59`;

  let q = sb
    .from('sales_orders')
    .select(`
      id, branch_id,
      items:sales_order_items(
        quantity, unit_price, total_price,
        product:products(id, name, code, cost)
      )
    `)
    .eq('status', 'COMPLETED')
    .gte('ordered_at', startDT)
    .lte('ordered_at', endDT);

  if (branchId) q = q.eq('branch_id', branchId);
  const { data: orders } = await q;

  const productMap = new Map<string, {
    name: string; code: string; cost: number;
    qty: number; revenue: number; totalCost: number;
  }>();

  for (const order of (orders || [])) {
    for (const item of (order.items || [])) {
      const p = item.product;
      if (!p) continue;
      const existing = productMap.get(p.id) || { name: p.name, code: p.code, cost: p.cost || 0, qty: 0, revenue: 0, totalCost: 0 };
      existing.qty      += item.quantity || 0;
      existing.revenue  += item.total_price || 0;
      existing.totalCost += (p.cost || 0) * (item.quantity || 0);
      productMap.set(p.id, existing);
    }
  }

  const rows = Array.from(productMap.entries())
    .map(([id, p]) => {
      const grossProfit  = p.revenue - p.totalCost;
      const marginPct    = p.revenue > 0 ? Math.round(grossProfit / p.revenue * 100) : 0;
      return { id, name: p.name, code: p.code, qty: p.qty, revenue: p.revenue, cogs: p.totalCost, grossProfit, marginPct };
    })
    .sort((a, b) => b.revenue - a.revenue);

  return { data: rows };
}

// ─── 수동 분개 생성 ───────────────────────────────────────────

export async function createJournalEntry(formData: FormData) {
  const sb = await createClient() as any;
  const userId = getUserId();

  const entryDate  = formData.get('entry_date') as string;
  const description = formData.get('description') as string;
  const linesJson  = formData.get('lines') as string;

  let lines: { account_id: string; debit: number; credit: number; memo: string }[];
  try {
    lines = JSON.parse(linesJson);
  } catch {
    return { error: '분개 라인 파싱 오류' };
  }

  const totalDebit  = lines.reduce((s, l) => s + (l.debit  || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return { error: `차변(${totalDebit.toLocaleString()}) ≠ 대변(${totalCredit.toLocaleString()}): 대차 불일치` };
  }
  if (lines.length < 2) return { error: '최소 2개의 분개 라인이 필요합니다.' };

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  const entryNumber = `JE-${date}-${rand}`;

  const { data: entry, error: entryErr } = await sb
    .from('journal_entries')
    .insert({
      entry_number: entryNumber,
      entry_date: entryDate,
      description,
      source_type: 'MANUAL',
      total_debit: totalDebit,
      total_credit: totalCredit,
      created_by: userId,
    })
    .select('id')
    .single();

  if (entryErr) return { error: entryErr.message };

  const { error: linesErr } = await sb
    .from('journal_entry_lines')
    .insert(lines.map(l => ({
      journal_entry_id: entry.id,
      account_id: l.account_id,
      debit: l.debit || 0,
      credit: l.credit || 0,
      memo: l.memo || null,
    })));

  if (linesErr) {
    await sb.from('journal_entries').delete().eq('id', entry.id);
    return { error: linesErr.message };
  }

  revalidatePath('/accounting');
  return { success: true, entryNumber };
}

// ─── 판매/매입 자동 분개 (내부 헬퍼) ─────────────────────────

export async function createSaleJournal(params: {
  orderId: string;
  orderNumber: string;
  orderDate: string;
  totalAmount: number;
  paymentMethod: string; // cash | card | kakao
  cogs: number;
}) {
  const sb = await createClient() as any;

  // 계정 조회
  const { data: accounts } = await sb
    .from('gl_accounts')
    .select('id, code')
    .in('code', ['1110', '1120', '4110', '5110', '1130']);

  const accMap = Object.fromEntries((accounts || []).map((a: any) => [a.code, a.id]));

  // 현금 vs 카드 결정
  const receivableCode = params.paymentMethod === 'cash' ? '1110' : '1120';
  const receivableId   = accMap[receivableCode];
  const revenueId      = accMap['4110'];
  const cogsId         = accMap['5110'];
  const inventoryId    = accMap['1130'];

  if (!receivableId || !revenueId) return; // 계정 미설정 시 스킵

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  const entryNumber = `JE-SA-${date}-${rand}`;

  const { data: entry, error } = await sb
    .from('journal_entries')
    .insert({
      entry_number: entryNumber,
      entry_date: params.orderDate,
      description: `매출 인식 (${params.orderNumber})`,
      source_type: 'SALE',
      source_id: params.orderId,
      total_debit: params.totalAmount,
      total_credit: params.totalAmount,
    })
    .select('id')
    .single();

  if (error) return;

  const lines = [
    { journal_entry_id: entry.id, account_id: receivableId, debit: params.totalAmount, credit: 0, memo: params.orderNumber },
    { journal_entry_id: entry.id, account_id: revenueId, debit: 0, credit: params.totalAmount, memo: params.orderNumber },
  ];

  if (cogsId && inventoryId && params.cogs > 0) {
    lines.push(
      { journal_entry_id: entry.id, account_id: cogsId, debit: params.cogs, credit: 0, memo: '매출원가' },
      { journal_entry_id: entry.id, account_id: inventoryId, debit: 0, credit: params.cogs, memo: '재고 감소' }
    );
  }

  await sb.from('journal_entry_lines').insert(lines);
}

export async function createPurchaseReceiptJournal(params: {
  receiptId: string;
  receiptNumber: string;
  receiptDate: string;
  totalAmount: number;
}) {
  const sb = await createClient() as any;

  const { data: accounts } = await sb
    .from('gl_accounts')
    .select('id, code')
    .in('code', ['1130', '2110']);

  const accMap = Object.fromEntries((accounts || []).map((a: any) => [a.code, a.id]));
  const inventoryId  = accMap['1130'];
  const payableId    = accMap['2110'];

  if (!inventoryId || !payableId) return;

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  const entryNumber = `JE-PR-${date}-${rand}`;

  const { data: entry, error } = await sb
    .from('journal_entries')
    .insert({
      entry_number: entryNumber,
      entry_date: params.receiptDate,
      description: `매입 인식 (${params.receiptNumber})`,
      source_type: 'PURCHASE_RECEIPT',
      source_id: params.receiptId,
      total_debit: params.totalAmount,
      total_credit: params.totalAmount,
    })
    .select('id')
    .single();

  if (error) return;

  await sb.from('journal_entry_lines').insert([
    { journal_entry_id: entry.id, account_id: inventoryId, debit: params.totalAmount, credit: 0, memo: params.receiptNumber },
    { journal_entry_id: entry.id, account_id: payableId, debit: 0, credit: params.totalAmount, memo: params.receiptNumber },
  ]);
}
