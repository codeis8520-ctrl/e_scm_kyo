'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { requireSession } from '@/lib/session';

// ─── 거래처별 단가표 ──────────────────────────────────────────────────

export async function getPartnerPrices(partnerId: string) {
  const sb = (await createClient()) as any;
  const { data, error } = await sb
    .from('b2b_partner_prices')
    .select('*, product:products(id, name, code, price)')
    .eq('partner_id', partnerId)
    .order('created_at');
  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}

export async function upsertPartnerPrice(params: {
  partnerId: string;
  productId: string;
  unitPrice: number;
  memo?: string;
}) {
  try { await requireSession(); } catch (e: any) { return { error: e.message }; }
  const sb = (await createClient()) as any;

  // 정가 조회해서 할인율 자동 계산
  const { data: product } = await sb.from('products').select('price').eq('id', params.productId).single();
  const retailPrice = Number(product?.price || 0);
  const discountRate = retailPrice > 0 ? Math.round((1 - params.unitPrice / retailPrice) * 10000) / 100 : 0;

  const { error } = await sb.from('b2b_partner_prices').upsert({
    partner_id: params.partnerId,
    product_id: params.productId,
    unit_price: params.unitPrice,
    discount_rate: discountRate,
    memo: params.memo || null,
    effective_from: new Date().toISOString().slice(0, 10),
  }, { onConflict: 'partner_id,product_id' });

  if (error) return { error: error.message };
  revalidatePath('/trade');
  return { success: true };
}

export async function bulkUpsertPartnerPrices(partnerId: string, prices: Array<{ productId: string; unitPrice: number }>) {
  try { await requireSession(); } catch (e: any) { return { error: e.message }; }
  const sb = (await createClient()) as any;

  // 정가 조회
  const productIds = prices.map(p => p.productId);
  const { data: products } = await sb.from('products').select('id, price').in('id', productIds);
  const priceMap = Object.fromEntries((products || []).map((p: any) => [p.id, Number(p.price)]));

  const rows = prices.map(p => {
    const retail = priceMap[p.productId] || 0;
    return {
      partner_id: partnerId,
      product_id: p.productId,
      unit_price: p.unitPrice,
      discount_rate: retail > 0 ? Math.round((1 - p.unitPrice / retail) * 10000) / 100 : 0,
      effective_from: new Date().toISOString().slice(0, 10),
    };
  });

  const { error } = await sb.from('b2b_partner_prices').upsert(rows, { onConflict: 'partner_id,product_id' });
  if (error) return { error: error.message };
  revalidatePath('/trade');
  return { success: true, count: rows.length };
}

export async function deletePartnerPrice(partnerId: string, productId: string) {
  try { await requireSession(); } catch (e: any) { return { error: e.message }; }
  const sb = (await createClient()) as any;
  await sb.from('b2b_partner_prices').delete().eq('partner_id', partnerId).eq('product_id', productId);
  revalidatePath('/trade');
  return { success: true };
}

// 거래처+제품으로 납품 단가 조회 (납품 등록 시 자동 적용)
export async function getPartnerProductPrice(partnerId: string, productId: string): Promise<number | null> {
  const sb = (await createClient()) as any;
  const { data } = await sb
    .from('b2b_partner_prices')
    .select('unit_price')
    .eq('partner_id', partnerId)
    .eq('product_id', productId)
    .maybeSingle();
  return data?.unit_price ?? null;
}

// ─── 거래처 CRUD ─────────────────────────────────────────────────────

export async function getB2bPartners() {
  const sb = (await createClient()) as any;
  const { data, error } = await sb
    .from('b2b_partners')
    .select('*')
    .order('name');
  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}

export async function createB2bPartner(params: {
  name: string; code?: string; business_no?: string;
  contact_name?: string; phone?: string; email?: string; address?: string;
  settlement_cycle?: string; settlement_day?: number; memo?: string;
}) {
  try { await requireSession(); } catch (e: any) { return { error: e.message }; }
  const sb = (await createClient()) as any;
  const code = params.code || `BP-${Date.now().toString(36).toUpperCase()}`;
  const { error } = await sb.from('b2b_partners').insert({ ...params, code });
  if (error) return { error: error.message };
  revalidatePath('/trade');
  return { success: true };
}

export async function updateB2bPartner(id: string, params: Record<string, any>) {
  try { await requireSession(); } catch (e: any) { return { error: e.message }; }
  const sb = (await createClient()) as any;
  const { error } = await sb.from('b2b_partners').update(params).eq('id', id);
  if (error) return { error: error.message };
  revalidatePath('/trade');
  return { success: true };
}

// ─── 거래처 납품(매출) ────────────────────────────────────────────────

export async function getB2bSalesOrders(filters?: { partnerId?: string; status?: string; startDate?: string; endDate?: string }) {
  const sb = (await createClient()) as any;
  let q = sb
    .from('b2b_sales_orders')
    .select('*, partner:b2b_partners(name, code), branch:branches(name), items:b2b_sales_order_items(*, product:products(name, code))')
    .order('delivered_at', { ascending: false })
    .limit(200);

  if (filters?.partnerId) q = q.eq('partner_id', filters.partnerId);
  if (filters?.status) q = q.eq('status', filters.status);
  if (filters?.startDate) q = q.gte('delivered_at', `${filters.startDate}T00:00:00`);
  if (filters?.endDate) q = q.lte('delivered_at', `${filters.endDate}T23:59:59`);

  const { data, error } = await q;
  if (error) return { data: [], error: error.message };
  return { data: data || [] };
}

export async function createB2bSalesOrder(params: {
  partnerId: string;
  branchId?: string;
  items: Array<{ productId: string; quantity: number; unitPrice: number }>;
  memo?: string;
  deliveredAt?: string;
}) {
  let session;
  try { session = await requireSession(); } catch (e: any) { return { error: e.message }; }
  const sb = (await createClient()) as any;

  // 거래처 정보
  const { data: partner } = await sb.from('b2b_partners').select('settlement_cycle, settlement_day, code').eq('id', params.partnerId).single();
  if (!partner) return { error: '거래처를 찾을 수 없습니다.' };

  // 전표번호
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  const orderNumber = `B2B-${date}-${rand}`;

  // 총액
  const totalAmount = params.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);

  // 정산 예정일 계산
  const now = new Date();
  let dueDate: string | null = null;
  if (partner.settlement_cycle === 'MONTHLY' && partner.settlement_day) {
    const d = new Date(now.getFullYear(), now.getMonth() + 1, partner.settlement_day);
    dueDate = d.toISOString().slice(0, 10);
  } else if (partner.settlement_cycle === 'BIWEEKLY') {
    const d = new Date(now.getTime() + 14 * 86400000);
    dueDate = d.toISOString().slice(0, 10);
  } else if (partner.settlement_cycle === 'WEEKLY') {
    const d = new Date(now.getTime() + 7 * 86400000);
    dueDate = d.toISOString().slice(0, 10);
  }

  const { data: order, error: orderErr } = await sb.from('b2b_sales_orders').insert({
    order_number: orderNumber,
    partner_id: params.partnerId,
    branch_id: params.branchId || null,
    total_amount: totalAmount,
    status: 'DELIVERED',
    delivered_at: params.deliveredAt || new Date().toISOString(),
    settlement_due_date: dueDate,
    memo: params.memo || null,
    created_by: session.id,
  }).select('id').single();

  if (orderErr) return { error: orderErr.message };

  // 항목 저장
  const itemRows = params.items.map(i => ({
    b2b_sales_order_id: order.id,
    product_id: i.productId,
    quantity: i.quantity,
    unit_price: i.unitPrice,
    total_price: i.quantity * i.unitPrice,
  }));
  await sb.from('b2b_sales_order_items').insert(itemRows);

  // 재고 차감 (출고 지점이 지정된 경우)
  if (params.branchId) {
    for (const item of params.items) {
      const { data: inv } = await sb.from('inventories')
        .select('id, quantity')
        .eq('branch_id', params.branchId)
        .eq('product_id', item.productId)
        .maybeSingle();
      if (inv) {
        await sb.from('inventories').update({ quantity: Math.max(0, inv.quantity - item.quantity) }).eq('id', inv.id);
        await sb.from('inventory_movements').insert({
          branch_id: params.branchId,
          product_id: item.productId,
          movement_type: 'OUT',
          quantity: item.quantity,
          reference_id: order.id,
          reference_type: 'B2B_SALE',
          memo: `거래처 납품 ${orderNumber}`,
        });
      }
    }
  }

  // 납품 분개: 차변 외상매출금(1115) / 대변 매출(4110) + 부가세예수금(2151)
  try {
    const { data: accounts } = await sb
      .from('gl_accounts').select('id, code')
      .in('code', ['1115', '4130', '2151']);
    const accMap: Record<string, string> = {};
    (accounts || []).forEach((a: any) => { accMap[a.code] = a.id; });

    const arId = accMap['1115'];       // 외상매출금
    const revenueId = accMap['4130'];  // B2B매출
    const vatId = accMap['2151'];      // 부가세예수금

    if (arId && revenueId) {
      const supplyAmount = Math.round(totalAmount / 1.1);
      const vatAmount = totalAmount - supplyAmount;
      const jeNumber = `JE-B2B-${date}-${rand}`;

      const { data: entry } = await sb.from('journal_entries').insert({
        entry_number: jeNumber,
        entry_date: (params.deliveredAt || now.toISOString()).slice(0, 10),
        description: `B2B 납품 매출 — ${orderNumber}`,
        source_type: 'B2B_SALE',
        source_id: order.id,
        total_debit: totalAmount,
        total_credit: totalAmount,
      }).select('id').single();

      if (entry) {
        const lines: any[] = [
          { journal_entry_id: entry.id, account_id: arId, debit: totalAmount, credit: 0, memo: `외상매출금 (${orderNumber})` },
          { journal_entry_id: entry.id, account_id: revenueId, debit: 0, credit: supplyAmount, memo: `매출 공급가 (${orderNumber})` },
        ];
        if (vatId && vatAmount > 0) {
          lines.push({ journal_entry_id: entry.id, account_id: vatId, debit: 0, credit: vatAmount, memo: `부가세 (${orderNumber})` });
        }
        await sb.from('journal_entry_lines').insert(lines);
      }
    }
  } catch (journalErr: any) {
    console.warn('B2B 납품 분개 생성 실패(무시):', journalErr?.message);
  }

  revalidatePath('/trade');
  return { success: true, orderNumber };
}

// ─── 수금(정산) 처리 ─────────────────────────────────────────────────

export async function settleB2bOrder(orderId: string, amount: number, method?: string) {
  try { await requireSession(); } catch (e: any) { return { error: e.message }; }
  const sb = (await createClient()) as any;

  const { data: order } = await sb.from('b2b_sales_orders')
    .select('id, order_number, total_amount, settled_amount, status')
    .eq('id', orderId).single();
  if (!order) return { error: '납품 전표를 찾을 수 없습니다.' };
  if (order.status === 'SETTLED') return { error: '이미 정산 완료된 건입니다.' };
  if (order.status === 'CANCELLED') return { error: '취소된 건입니다.' };

  const newSettled = (Number(order.settled_amount) || 0) + amount;
  const isFullySettled = newSettled >= Number(order.total_amount);

  await sb.from('b2b_sales_orders').update({
    settled_amount: newSettled,
    status: isFullySettled ? 'SETTLED' : 'PARTIALLY_SETTLED',
    settled_at: isFullySettled ? new Date().toISOString() : null,
  }).eq('id', orderId);

  // 수금 분개: 차변 현금/보통예금(1110/1120) / 대변 외상매출금(1115)
  try {
    const { data: accounts } = await sb
      .from('gl_accounts').select('id, code')
      .in('code', ['1110', '1115', '1120']);
    const accMap: Record<string, string> = {};
    (accounts || []).forEach((a: any) => { accMap[a.code] = a.id; });

    const debitCode = method === 'card' ? '1120' : '1110'; // 카드 or 현금(기본)
    const debitId = accMap[debitCode];
    const creditId = accMap['1115']; // 외상매출금

    if (debitId && creditId) {
      const now = new Date().toISOString();
      const dateStr = now.slice(0, 10).replace(/-/g, '');
      const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
      const jeNumber = `JE-B2S-${dateStr}-${rand}`;

      const { data: entry } = await sb.from('journal_entries').insert({
        entry_number: jeNumber,
        entry_date: now.slice(0, 10),
        description: `B2B 수금 — ${order.order_number}`,
        source_type: 'B2B_SETTLE',
        source_id: orderId,
        total_debit: amount,
        total_credit: amount,
      }).select('id').single();

      if (entry) {
        await sb.from('journal_entry_lines').insert([
          { journal_entry_id: entry.id, account_id: debitId, debit: amount, credit: 0, memo: `수금 (${order.order_number})` },
          { journal_entry_id: entry.id, account_id: creditId, debit: 0, credit: amount, memo: `외상매출금 회수 (${order.order_number})` },
        ]);
      }
    }
  } catch (journalErr: any) {
    console.warn('B2B 수금 분개 생성 실패(무시):', journalErr?.message);
  }

  revalidatePath('/trade');
  return { success: true, newStatus: isFullySettled ? 'SETTLED' : 'PARTIALLY_SETTLED' };
}

// ─── 납품 취소 ────────────────────────────────────────────────────────

export async function cancelB2bOrder(orderId: string, reason?: string) {
  try { await requireSession(); } catch (e: any) { return { error: e.message }; }
  const sb = (await createClient()) as any;

  const { data: order } = await sb.from('b2b_sales_orders')
    .select('id, status, settled_amount, order_number, branch_id, items:b2b_sales_order_items(product_id, quantity)')
    .eq('id', orderId).single();
  if (!order) return { error: '납품 전표를 찾을 수 없습니다.' };
  if (order.status === 'CANCELLED') return { error: '이미 취소된 건입니다.' };
  if (Number(order.settled_amount) > 0) return { error: '수금이 진행된 건은 취소할 수 없습니다.' };

  // 재고 복원
  if (order.branch_id) {
    for (const item of (order.items || []) as any[]) {
      const { data: inv } = await sb.from('inventories')
        .select('id, quantity')
        .eq('branch_id', order.branch_id)
        .eq('product_id', item.product_id)
        .maybeSingle();
      if (inv) {
        await sb.from('inventories').update({ quantity: inv.quantity + item.quantity }).eq('id', inv.id);
        await sb.from('inventory_movements').insert({
          branch_id: order.branch_id,
          product_id: item.product_id,
          movement_type: 'IN',
          quantity: item.quantity,
          reference_type: 'B2B_CANCEL',
          memo: `거래처 납품 취소 ${order.order_number}${reason ? ' — ' + reason : ''}`,
        });
      }
    }
  }

  await sb.from('b2b_sales_orders').update({
    status: 'CANCELLED',
    memo: (order.memo ? order.memo + '\n' : '') + `[취소] ${reason || ''} (${new Date().toISOString().slice(0, 10)})`,
  }).eq('id', orderId);

  revalidatePath('/trade');
  return { success: true };
}

// ─── 거래처별 미수금 요약 ─────────────────────────────────────────────

export async function getB2bPartnerSummary() {
  const sb = (await createClient()) as any;
  const { data: orders } = await sb
    .from('b2b_sales_orders')
    .select('partner_id, total_amount, settled_amount, status, partner:b2b_partners(name, code)')
    .in('status', ['DELIVERED', 'PARTIALLY_SETTLED']);

  const map = new Map<string, { name: string; code: string; count: number; totalSales: number; totalSettled: number }>();
  for (const o of (orders || []) as any[]) {
    const cur = map.get(o.partner_id) || { name: o.partner?.name, code: o.partner?.code, count: 0, totalSales: 0, totalSettled: 0 };
    cur.count++;
    cur.totalSales += Number(o.total_amount);
    cur.totalSettled += Number(o.settled_amount || 0);
    map.set(o.partner_id, cur);
  }

  return {
    data: Array.from(map.entries()).map(([id, v]) => ({
      partnerId: id, ...v,
      outstanding: v.totalSales - v.totalSettled,
    })).sort((a, b) => b.outstanding - a.outstanding),
  };
}
