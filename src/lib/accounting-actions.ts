'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { requireSession } from '@/lib/session';

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

/**
 * 매출 분개 생성 — 한국 기업회계기준 부가세 분리
 *
 * 과세(is_taxable=true) 제품:
 *   총액 = 공급가 + 부가세
 *   공급가 = 총액 ÷ 1.1 (반올림)
 *   부가세 = 총액 - 공급가
 *
 * 분개:
 *   차변: 현금/카드/외상매출금  totalAmount
 *   대변: 매출(4110)           supplyAmount (공급가)
 *   대변: 부가세예수금(2151)    vatAmount (세액)
 *   (면세 품목은 VAT 라인 생략, 전액 매출)
 *
 * 환불(음수 금액) 시 역분개:
 *   차변/대변 반전 (음수 → 차변이 대변, 대변이 차변)
 */
export async function createSaleJournal(params: {
  orderId: string;
  orderNumber: string;
  orderDate: string;
  totalAmount: number;       // 세금 포함 총액 (음수면 환불/역분개)
  paymentMethod: string;     // cash | card | kakao | card_keyin | credit
  cogs: number;
  taxableAmount?: number;    // 과세 대상 금액 (미제공 시 전액 과세 가정)
  sourceType?: string;       // SALE | RETURN | CREDIT_CANCEL | CAFE24_REFUND
  reversalOf?: string;       // 역분개 시 원래 journal_entry ID
  createdBy?: string;        // 실행한 사용자 ID
}) {
  const sb = await createClient() as any;

  // 계정 조회 (부가세예수금 2151 포함)
  const { data: accounts } = await sb
    .from('gl_accounts')
    .select('id, code')
    .in('code', ['1110', '1115', '1120', '2151', '4110', '5110', '1130']);

  const accMap = Object.fromEntries((accounts || []).map((a: any) => [a.code, a.id]));

  // 수금 계정 결정
  const receivableCode =
    params.paymentMethod === 'cash'   ? '1110' :
    params.paymentMethod === 'credit' ? '1115' :
    '1120'; // card, kakao, card_keyin
  const receivableId = accMap[receivableCode];
  const revenueId    = accMap['4110'];
  const vatId        = accMap['2151'];
  const cogsId       = accMap['5110'];
  const inventoryId  = accMap['1130'];

  if (!receivableId || !revenueId) return;

  const isRefund = params.totalAmount < 0;
  const absTotal = Math.abs(params.totalAmount);

  // VAT 계산: 과세 대상 금액에서 분리
  const taxableBase = params.taxableAmount !== undefined
    ? Math.abs(params.taxableAmount)
    : absTotal; // 미제공 시 전액 과세
  const supplyAmount = Math.round(taxableBase / 1.1);       // 공급가
  const vatAmount    = taxableBase - supplyAmount;           // 세액
  const exemptAmount = absTotal - taxableBase;               // 면세 금액

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  const prefix = isRefund ? 'JE-RF' : 'JE-SA';
  const entryNumber = `${prefix}-${date}-${rand}`;

  const sourceType = params.sourceType || (isRefund ? 'RETURN' : 'SALE');

  const { data: entry, error } = await sb
    .from('journal_entries')
    .insert({
      entry_number: entryNumber,
      entry_date: params.orderDate,
      description: isRefund
        ? `매출 환불 역분개 (${params.orderNumber})`
        : `매출 인식 (${params.orderNumber})`,
      source_type: sourceType,
      source_id: params.orderId,
      total_debit: absTotal,
      total_credit: absTotal,
      ...(params.reversalOf ? { reversal_of: params.reversalOf } : {}),
      ...(params.createdBy ? { created_by: params.createdBy } : {}),
    })
    .select('id')
    .single();

  if (error) return;

  const lines: any[] = [];

  if (isRefund) {
    // ── 역분개 (환불): 차변/대변 반전 ──
    // 차변: 매출(공급가) + 부가세예수금(세액)
    lines.push({ journal_entry_id: entry.id, account_id: revenueId, debit: supplyAmount + exemptAmount, credit: 0, memo: `환불 매출 취소 (${params.orderNumber})` });
    if (vatId && vatAmount > 0) {
      lines.push({ journal_entry_id: entry.id, account_id: vatId, debit: vatAmount, credit: 0, memo: `환불 VAT 취소` });
    }
    // 대변: 현금/카드/외상 반환
    lines.push({ journal_entry_id: entry.id, account_id: receivableId, debit: 0, credit: absTotal, memo: `환불 (${params.orderNumber})` });
  } else {
    // ── 정상 매출 분개 ──
    // 차변: 현금/카드/외상 수취
    lines.push({ journal_entry_id: entry.id, account_id: receivableId, debit: absTotal, credit: 0, memo: params.orderNumber });
    // 대변: 매출(공급가 + 면세분)
    lines.push({ journal_entry_id: entry.id, account_id: revenueId, debit: 0, credit: supplyAmount + exemptAmount, memo: `매출 (공급가${exemptAmount > 0 ? '+면세' : ''})` });
    // 대변: 부가세예수금(세액) — 계정 있고 금액 > 0인 경우만
    if (vatId && vatAmount > 0) {
      lines.push({ journal_entry_id: entry.id, account_id: vatId, debit: 0, credit: vatAmount, memo: `부가세 (${params.orderNumber})` });
    }
  }

  // COGS (매출원가) — 정상 매출 시만
  if (!isRefund && cogsId && inventoryId && params.cogs > 0) {
    lines.push(
      { journal_entry_id: entry.id, account_id: cogsId, debit: params.cogs, credit: 0, memo: '매출원가' },
      { journal_entry_id: entry.id, account_id: inventoryId, debit: 0, credit: params.cogs, memo: '재고 감소' }
    );
  }

  await sb.from('journal_entry_lines').insert(lines);
}

/**
 * 매입 분개 — VAT 분리 (매출과 동일 구조)
 *
 * 과세 매입:
 *   차변: 재고자산(1130) 공급가 + 부가세대급금(1150) 세액
 *   대변: 미지급금(2110) 총액
 */
export async function createPurchaseReceiptJournal(params: {
  receiptId: string;
  receiptNumber: string;
  receiptDate: string;
  totalAmount: number;
  taxableAmount?: number; // 미제공 시 전액 과세
}) {
  const sb = await createClient() as any;

  const { data: accounts } = await sb
    .from('gl_accounts')
    .select('id, code')
    .in('code', ['1130', '1150', '2110']);

  const accMap = Object.fromEntries((accounts || []).map((a: any) => [a.code, a.id]));
  const inventoryId    = accMap['1130'];
  const inputVatId     = accMap['1150']; // 부가세대급금
  const payableId      = accMap['2110'];

  if (!inventoryId || !payableId) return;

  const absTotal = Math.abs(params.totalAmount);
  const taxableBase = params.taxableAmount !== undefined ? Math.abs(params.taxableAmount) : absTotal;
  const supplyAmount = Math.round(taxableBase / 1.1);
  const vatAmount = taxableBase - supplyAmount;
  const exemptAmount = absTotal - taxableBase;

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
      total_debit: absTotal,
      total_credit: absTotal,
    })
    .select('id')
    .single();

  if (error) return;

  const lines: any[] = [
    // 차변: 재고자산 (공급가 + 면세분)
    { journal_entry_id: entry.id, account_id: inventoryId, debit: supplyAmount + exemptAmount, credit: 0, memo: `매입 (공급가)` },
  ];
  // 차변: 부가세대급금 (세액) — 환급 권리
  if (inputVatId && vatAmount > 0) {
    lines.push({ journal_entry_id: entry.id, account_id: inputVatId, debit: vatAmount, credit: 0, memo: `매입 VAT (${params.receiptNumber})` });
  }
  // 대변: 미지급금 (총액)
  lines.push({ journal_entry_id: entry.id, account_id: payableId, debit: 0, credit: absTotal, memo: params.receiptNumber });

  await sb.from('journal_entry_lines').insert(lines);
}

// ═══════════════════════════════════════════════════════════════════════
// 부가세 신고 데이터 조회
// ═══════════════════════════════════════════════════════════════════════

export async function getVatReport(params: { startDate: string; endDate: string }) {
  const sb = await createClient() as any;

  // GL 계정 ID 조회
  const { data: accounts } = await sb
    .from('gl_accounts')
    .select('id, code, name')
    .in('code', ['2151', '1150']);
  const accMap = Object.fromEntries((accounts || []).map((a: any) => [a.code, a]));

  const outputVatAccId = accMap['2151']?.id; // 부가세예수금
  const inputVatAccId  = accMap['1150']?.id; // 부가세대급금

  // 기간 내 분개 라인 집계
  const { data: lines } = await sb
    .from('journal_entry_lines')
    .select('account_id, debit, credit, journal_entry:journal_entries!inner(entry_date)')
    .gte('journal_entry.entry_date', params.startDate)
    .lte('journal_entry.entry_date', params.endDate);

  let outputVatCredit = 0; // 매출 VAT (대변 합계)
  let outputVatDebit = 0;  // 매출 VAT 취소 (차변 합계, 환불 등)
  let inputVatDebit = 0;   // 매입 VAT (차변 합계)
  let inputVatCredit = 0;  // 매입 VAT 취소

  for (const line of (lines || []) as any[]) {
    if (line.account_id === outputVatAccId) {
      outputVatCredit += Number(line.credit || 0);
      outputVatDebit += Number(line.debit || 0);
    }
    if (line.account_id === inputVatAccId) {
      inputVatDebit += Number(line.debit || 0);
      inputVatCredit += Number(line.credit || 0);
    }
  }

  const netOutputVat = outputVatCredit - outputVatDebit; // 매출 부가세 (납부)
  const netInputVat = inputVatDebit - inputVatCredit;    // 매입 부가세 (환급)
  const vatPayable = netOutputVat - netInputVat;         // 납부 세액 (양수=납부, 음수=환급)

  return {
    period: `${params.startDate} ~ ${params.endDate}`,
    outputVat: { credit: outputVatCredit, debit: outputVatDebit, net: netOutputVat },
    inputVat: { debit: inputVatDebit, credit: inputVatCredit, net: netInputVat },
    vatPayable,
    summary: vatPayable >= 0
      ? `납부 세액: ${vatPayable.toLocaleString()}원`
      : `환급 세액: ${Math.abs(vatPayable).toLocaleString()}원`,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// GL 기반 계정 잔액 집계 (재무제표용)
// ═══════════════════════════════════════════════════════════════════════

export async function getGlBalances(params: { startDate: string; endDate: string }) {
  const sb = await createClient() as any;

  const { data: accounts } = await sb
    .from('gl_accounts')
    .select('id, code, name, account_type')
    .eq('is_active', true)
    .order('sort_order');

  const { data: lines } = await sb
    .from('journal_entry_lines')
    .select('account_id, debit, credit, journal_entry:journal_entries!inner(entry_date)')
    .gte('journal_entry.entry_date', params.startDate)
    .lte('journal_entry.entry_date', params.endDate);

  // 계정별 집계
  const balances = new Map<string, { debit: number; credit: number }>();
  for (const line of (lines || []) as any[]) {
    const cur = balances.get(line.account_id) || { debit: 0, credit: 0 };
    cur.debit += Number(line.debit || 0);
    cur.credit += Number(line.credit || 0);
    balances.set(line.account_id, cur);
  }

  const result = ((accounts || []) as any[]).map(acc => {
    const bal = balances.get(acc.id) || { debit: 0, credit: 0 };
    // 자산·비용·원가: 차변 - 대변 = 잔액. 부채·자본·수익: 대변 - 차변 = 잔액.
    const isDebitNormal = ['ASSET', 'EXPENSE', 'COGS'].includes(acc.account_type);
    const balance = isDebitNormal ? bal.debit - bal.credit : bal.credit - bal.debit;
    return {
      code: acc.code,
      name: acc.name,
      type: acc.account_type,
      debit: bal.debit,
      credit: bal.credit,
      balance,
    };
  }).filter(a => a.debit > 0 || a.credit > 0); // 거래 없는 계정 제외

  return { accounts: result };
}

// ═══════════════════════════════════════════════════════════════════════
// 기간 마감
// ═══════════════════════════════════════════════════════════════════════

export async function closePeriod(period: string) {
  let session;
  try { session = await requireSession(); } catch (e: any) { return { error: e.message }; }
  const HQ = new Set(['SUPER_ADMIN', 'HQ_OPERATOR']);
  if (session.role && !HQ.has(session.role)) {
    return { error: '기간 마감은 본사 권한이 필요합니다.' };
  }

  const sb = await createClient() as any;

  // 이미 마감됐는지 확인
  const { data: existing } = await sb
    .from('accounting_period_closes')
    .select('id')
    .eq('period', period)
    .maybeSingle();
  if (existing) return { error: `${period}은(는) 이미 마감되었습니다.` };

  const { error } = await sb
    .from('accounting_period_closes')
    .insert({ period, closed_by: session.id });
  if (error) return { error: error.message };

  return { success: true, period };
}

export async function reopenPeriod(period: string) {
  let session;
  try { session = await requireSession(); } catch (e: any) { return { error: e.message }; }
  if (session.role !== 'SUPER_ADMIN') {
    return { error: '기간 재개는 최고관리자만 가능합니다.' };
  }

  const sb = await createClient() as any;
  await sb.from('accounting_period_closes').delete().eq('period', period);
  return { success: true };
}

export async function getClosedPeriods() {
  const sb = await createClient() as any;
  const { data } = await sb
    .from('accounting_period_closes')
    .select('period, closed_at, closed_by')
    .order('period', { ascending: false });
  return { data: data || [] };
}

export async function isPeriodClosed(period: string): Promise<boolean> {
  const sb = await createClient() as any;
  const { data } = await sb
    .from('accounting_period_closes')
    .select('id')
    .eq('period', period)
    .maybeSingle();
  return !!data;
}

// ─── 외상 수금 처리 ────────────────────────────────────────────────────────

export async function settleCreditOrder(params: {
  orderId: string;
  settledMethod: 'cash' | 'card' | 'kakao' | 'card_keyin';
}): Promise<{ success: boolean; error?: string }> {
  const sb = await createClient() as any;

  // 1. 주문 조회
  const { data: order, error: fetchErr } = await sb
    .from('sales_orders')
    .select('id, order_number, total_amount, credit_settled, ordered_at')
    .eq('id', params.orderId)
    .eq('payment_method', 'credit')
    .single();

  if (fetchErr || !order) return { success: false, error: '외상 주문을 찾을 수 없습니다.' };
  if (order.credit_settled) return { success: false, error: '이미 수금 처리된 주문입니다.' };

  const now = new Date().toISOString();

  // 2. 수금 처리 업데이트
  const { error: updateErr } = await sb
    .from('sales_orders')
    .update({
      credit_settled: true,
      credit_settled_at: now,
      credit_settled_method: params.settledMethod,
    })
    .eq('id', params.orderId);

  if (updateErr) return { success: false, error: updateErr.message };

  // 3. 수금 분개: 차변 현금/카드(1110/1120) ← 대변 외상매출금(1115)
  try {
    const { data: accounts } = await sb
      .from('gl_accounts')
      .select('id, code')
      .in('code', ['1110', '1115', '1120']);

    const accMap: Record<string, string> = {};
    (accounts || []).forEach((a: any) => { accMap[a.code] = a.id; });

    const debitCode = params.settledMethod === 'cash' ? '1110' : '1120';
    const debitId   = accMap[debitCode];
    const creditId  = accMap['1115'];

    if (!debitId || !creditId) throw new Error('GL 계정 없음');

    const amount = Number(order.total_amount);
    const jeNumber = `JE-CR-${now.slice(0, 10).replace(/-/g, '')}-${order.order_number.slice(-4)}`;

    const { data: entry, error: jeErr } = await sb
      .from('journal_entries')
      .insert({
        entry_number: jeNumber,
        entry_date: now.slice(0, 10),
        description: `외상 수금 — ${order.order_number}`,
        source_type: 'CREDIT_SETTLE',
        source_id: params.orderId,
        total_debit: amount,
        total_credit: amount,
      })
      .select('id')
      .single();

    if (jeErr) throw jeErr;

    await sb.from('journal_entry_lines').insert([
      { journal_entry_id: entry.id, account_id: debitId,  debit: amount, credit: 0,      memo: '수금' },
      { journal_entry_id: entry.id, account_id: creditId, debit: 0,      credit: amount, memo: '외상매출금 회수' },
    ]);
  } catch (journalErr: any) {
    // 분개 실패는 경고만 — 수금 처리 자체는 완료됨
    console.warn('수금 분개 생성 실패(무시):', journalErr?.message);
  }

  return { success: true };
}
