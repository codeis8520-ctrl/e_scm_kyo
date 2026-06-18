import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getValidAccessToken, forceRefreshAccessToken } from '@/lib/cafe24/token-store';
import { cafe24SelfPoints } from '@/lib/cafe24/types';

// ─────────────────────────────────────────────────────────────────────────────
// #42 Step 2 — 자사몰 적립금 매출 제외 백필 (기존 cafe24 주문)
//
// Step 1 은 신규 주문만 보정. 기존 ONLINE 주문은 적립금이 discount 에 안 들어가
// 매출 과대(상품금액). 이 라우트가 cafe24 상세를 재조회해 자사몰 적립금(points_spent)을
// 추출하고 sales_orders.discount_amount 에 가산 + payment_info 기록한다.
//
// 정책(Project Owner): **매출표만 정정**. 과거 매출분개(journal)는 손대지 않음(#15 전례).
// 멱등: payment_info 에 '적립금' 표기가 이미 있으면 skip(재실행 안전).
// 보호: CRON_SECRET. dry=1 이면 미적용 미리보기.
// ─────────────────────────────────────────────────────────────────────────────

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const secret = request.headers.get('authorization')?.replace('Bearer ', '') || searchParams.get('secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const dry = searchParams.get('dry') === '1';
  const limit = Math.min(Number(searchParams.get('limit') || 200), 500);

  const mallId = process.env.CAFE24_MALL_ID;
  if (!mallId) return NextResponse.json({ error: 'CAFE24_MALL_ID 없음' }, { status: 400 });

  let accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: '카페24 토큰 없음/만료' }, { status: 502 });

  const shopNo = process.env.CAFE24_SHOP_NO ?? '1';
  const base = `https://${mallId}.cafe24api.com/api/v2`;
  const makeHeaders = (t: string) => ({ Authorization: `Bearer ${t}`, 'X-Cafe24-Api-Version': '2026-03-01' });
  let headers = makeHeaders(accessToken);

  const sb = db();
  // 대상: 확정(COMPLETED) ONLINE 주문 중 적립금 미반영(payment_info 에 '적립금' 없음).
  const { data: orders, error } = await sb
    .from('sales_orders')
    .select('id, order_number, cafe24_order_id, total_amount, discount_amount, payment_info')
    .eq('channel', 'ONLINE')
    .eq('status', 'COMPLETED')
    .not('cafe24_order_id', 'is', null)
    .order('ordered_at', { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const targets = (orders ?? []).filter(o => !String(o.payment_info ?? '').includes('적립금'));

  let checked = 0, updated = 0, skippedNoPoints = 0, failed = 0;
  const changes: any[] = [];

  for (const o of targets) {
    checked++;
    try {
      const fetchDetail = () => fetch(`${base}/admin/orders/${o.cafe24_order_id}?shop_no=${shopNo}`, { headers });
      let res = await fetchDetail();
      if (res.status === 401) {
        const refreshed = await forceRefreshAccessToken();
        if (refreshed) { accessToken = refreshed; headers = makeHeaders(accessToken); res = await fetchDetail(); }
      }
      if (!res.ok) { failed++; continue; }
      const detail = await res.json();
      const detailOrder = detail?.order ?? null;
      const selfPoints = cafe24SelfPoints(detailOrder);
      if (!(selfPoints > 0)) { skippedNoPoints++; continue; }

      const newDiscount = Number(o.discount_amount || 0) + selfPoints;
      const baseInfo = String(o.payment_info ?? '').trim();
      const note = `자사몰 적립금 ${selfPoints.toLocaleString()}원 사용`;
      const newInfo = baseInfo ? `${baseInfo} / ${note}` : note;

      changes.push({
        order_number: o.order_number,
        total: Number(o.total_amount),
        discount_before: Number(o.discount_amount || 0),
        self_points: selfPoints,
        discount_after: newDiscount,
        net_before: Number(o.total_amount) - Number(o.discount_amount || 0),
        net_after: Number(o.total_amount) - newDiscount,
      });

      if (!dry) {
        const { error: upErr } = await sb
          .from('sales_orders')
          .update({ discount_amount: newDiscount, payment_info: newInfo })
          .eq('id', o.id);
        if (upErr) { failed++; continue; }
      }
      updated++;
    } catch {
      failed++;
    }
  }

  return NextResponse.json({
    dry, totalTargets: targets.length, checked, updated, skippedNoPoints, failed,
    note: '매출표(discount/payment_info)만 정정 — 매출분개(journal) 미변경(#15 전례)',
    changes: changes.slice(0, 100),
  });
}
