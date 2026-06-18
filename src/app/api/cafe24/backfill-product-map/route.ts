import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getValidAccessToken, forceRefreshAccessToken } from '@/lib/cafe24/token-store';
import { normalizeOptionValue, extractItemOptions } from '@/lib/cafe24/types';

// ─────────────────────────────────────────────────────────────────────────────
// 카페24 상품매핑 소급 백필 — 과거 ONLINE 전표 미매핑 품목에 product_id 채움.
//
// 신규 주문은 webhook syncCafe24OrderItems 가 (product_code + normalizeOptionValue(option))
// → cafe24_product_map 으로 자동 연결한다. 과거 전표는 그 매핑 이전에 생성돼 product_id=NULL.
// 이 라우트가 과거 주문의 cafe24 상세를 재조회해 동일 키로 map 을 적용 → UPDATE.
//   매칭: 전표 품목(item_text=cafe24 product_name, order_option=extractItemOptions) ↔ cafe24 상세 item.
//   product_id 매핑되면 product_id + item_text(내부명) 갱신. 재고/매출은 미변경(표시 백필만).
// 보호: CRON_SECRET. dry=1 미리보기.
// ─────────────────────────────────────────────────────────────────────────────

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
const mapKey = (code: string, opt: string) => `${code}\n${opt}`;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const secret = request.headers.get('authorization')?.replace('Bearer ', '') || searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const dry = searchParams.get('dry') === '1';

  const mallId = process.env.CAFE24_MALL_ID;
  if (!mallId) return NextResponse.json({ error: 'CAFE24_MALL_ID 없음' }, { status: 400 });
  let accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: '카페24 토큰 없음/만료' }, { status: 502 });

  const shopNo = process.env.CAFE24_SHOP_NO ?? '1';
  const base = `https://${mallId}.cafe24api.com/api/v2`;
  const makeHeaders = (t: string) => ({ Authorization: `Bearer ${t}`, 'X-Cafe24-Api-Version': '2026-03-01' });
  let headers = makeHeaders(accessToken);

  const sb = db();

  // 1) cafe24_product_map 일괄 로드 + 내부 제품명
  const { data: maps } = await sb.from('cafe24_product_map').select('cafe24_product_code, option_value, product_id');
  const productMap = new Map<string, string>();
  for (const m of (maps ?? []) as any[]) {
    productMap.set(mapKey(String(m.cafe24_product_code ?? ''), String(m.option_value ?? '')), m.product_id);
  }
  const pids = [...new Set([...productMap.values()])];
  const nameById = new Map<string, string>();
  if (pids.length) {
    const { data: prods } = await sb.from('products').select('id, name').in('id', pids);
    for (const p of (prods ?? []) as any[]) nameById.set(p.id, p.name);
  }

  // 2) 미매핑 품목 있는 ONLINE 주문 수집
  const { data: items } = await sb
    .from('sales_order_items')
    .select('id, sales_order_id, item_text, order_option, sales_order:sales_orders!inner(cafe24_order_id, channel)')
    .is('product_id', null);
  const so = (it: any) => Array.isArray(it.sales_order) ? it.sales_order[0] : it.sales_order;
  const targetItems = (items ?? []).filter((it: any) =>
    so(it)?.channel === 'ONLINE' && so(it)?.cafe24_order_id);

  // 주문별 그룹
  const byOrder = new Map<string, any[]>();
  for (const it of targetItems as any[]) {
    const oid = String(so(it).cafe24_order_id);
    const arr = byOrder.get(oid) || []; arr.push(it); byOrder.set(oid, arr);
  }

  let updated = 0, ordersChecked = 0, noMatch = 0, failed = 0;
  const changes: any[] = [];

  for (const [cafe24OrderId, orderItems] of byOrder) {
    ordersChecked++;
    try {
      const fetchDetail = () => fetch(`${base}/admin/orders/${cafe24OrderId}?shop_no=${shopNo}&embed=items`, { headers });
      let res = await fetchDetail();
      if (res.status === 401) {
        const r = await forceRefreshAccessToken();
        if (r) { accessToken = r; headers = makeHeaders(accessToken); res = await fetchDetail(); }
      }
      if (!res.ok) { failed++; continue; }
      const detail = await res.json();
      const cafeItems: any[] = detail?.order?.items ?? [];

      // cafe24 item → (matchKey: product_name|displayOption) → product_id
      const resolved = cafeItems.map((i: any) => ({
        productName: String(i?.product_name ?? ''),
        displayOpt: extractItemOptions(i) || null,
        pid: productMap.get(mapKey(String(i?.product_code ?? ''), normalizeOptionValue(i?.option_value))) ?? null,
      })).filter(r => r.pid);

      for (const soi of orderItems) {
        // 전표 품목(item_text/order_option) 과 cafe24 item 페어링
        const match = resolved.find(r =>
          r.productName === (soi.item_text ?? '') &&
          (r.displayOpt ?? null) === (soi.order_option ?? null));
        if (!match) { noMatch++; continue; }
        const internalName = nameById.get(match.pid as string) ?? null;
        changes.push({ cafe24OrderId, from: soi.item_text, to: internalName });
        if (!dry) {
          const { error } = await sb.from('sales_order_items')
            .update({ product_id: match.pid, item_text: internalName ?? soi.item_text })
            .eq('id', soi.id);
          if (error) { failed++; continue; }
        }
        updated++;
      }
    } catch {
      failed++;
    }
  }

  return NextResponse.json({
    dry, ordersChecked, updated, noMatch, failed,
    note: '표시 백필(product_id + item_text)만 — 재고/매출 미변경',
    changes: changes.slice(0, 100),
  });
}
