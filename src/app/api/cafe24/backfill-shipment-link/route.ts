/**
 * 과거 카페24 배송(shipments) NULL링크 백필 (#48 Phase 2a · 1회성 운영 트리거)
 *
 * shipments.sales_order_id IS NULL 이면서 cafe24_order_id 를 보유한 과거 배송을,
 * 같은 cafe24_order_id 를 가진 sales_orders 에 "정확매칭"으로 연결한다.
 *   매칭키 = cafe24_order_id 정확매칭만. 휴리스틱·이름·전화 매칭 절대 금지.
 *   정확히 1건 매칭일 때만 UPDATE. 0건/다건 매칭은 skip + 로그.
 *
 * 호출: GET /api/cafe24/backfill-shipment-link?dry=1&limit=100
 *   ?dry=1 (기본) — 실제 UPDATE 안 함, 매칭결과만 리포트.
 *   ?dry=0        — 실제 shipments.sales_order_id UPDATE.
 *   ?limit=       — 기본 100, 최대 500.
 * 인증: Authorization: Bearer ${CRON_SECRET}
 *
 * 멱등 — 이미 연결된 행은 대상쿼리(sales_order_id IS NULL)에서 자동제외, 반복호출 안전.
 * 건별 try/catch 로 한 건 실패가 배치 전체를 멈추지 않음.
 *
 * ⚠️ 비가역: dry=0 의 UPDATE 는 데이터변경(복구하려면 sales_order_id=NULL 수동복구 필요).
 *   2중연결 가드 — 이미 그 sales_order_id 에 다른 shipment 가 있으면 skip(would_duplicate).
 *   sales_order_id 부분 UNIQUE(마이그 094)는 이 backfill 후에 생성하므로, 순서상
 *   DB 가 아직 2중연결을 못 막는다 → 코드가 막는다.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

function getSupabase() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET 미설정' }, { status: 500 });
  }
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // dry=1 기본. dry=0 명시일 때만 실제 UPDATE.
  const dry = req.nextUrl.searchParams.get('dry') !== '0';
  const limit = Math.min(
    parseInt(req.nextUrl.searchParams.get('limit') || '100', 10) || 100,
    500
  );

  const supabase = getSupabase();

  // 대상: sales_order_id IS NULL AND cafe24_order_id IS NOT NULL.
  const { data: candidates, error: queryError } = await supabase
    .from('shipments')
    .select('id, cafe24_order_id, status')
    .is('sales_order_id', null)
    .not('cafe24_order_id', 'is', null)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  let scanned = 0;
  let matched = 0;
  let updated = 0;
  let unmatched_no_order = 0;
  let unmatched_ambiguous = 0;
  let would_duplicate = 0;
  const samples: { cafe24_order_id: string; result: string }[] = [];
  const pushSample = (cafe24_order_id: string, result: string) => {
    if (samples.length < 30) samples.push({ cafe24_order_id, result });
  };

  for (const ship of candidates ?? []) {
    scanned++;
    const cafe24OrderId = ship.cafe24_order_id as string;
    try {
      // cafe24_order_id 정확매칭 — single 금지(다건 가능성 대비 배열 길이 확인).
      const { data: orders, error: orderErr } = await supabase
        .from('sales_orders')
        .select('id')
        .eq('cafe24_order_id', cafe24OrderId);

      if (orderErr) {
        unmatched_no_order++;
        pushSample(cafe24OrderId, 'error:' + orderErr.message);
        continue;
      }

      const list = orders ?? [];
      if (list.length === 0) {
        unmatched_no_order++;
        pushSample(cafe24OrderId, 'no_order');
        continue;
      }
      if (list.length > 1) {
        unmatched_ambiguous++;
        pushSample(cafe24OrderId, 'ambiguous(' + list.length + ')');
        continue;
      }

      const matchedId = list[0].id as string;
      matched++;

      // 2중연결 가드: 이미 그 sales_order_id 에 다른 shipment 가 연결돼 있으면 skip.
      //   (UNIQUE 마이그 전이라 DB 가 안 막으니 코드가 막는다.)
      const { data: existing } = await supabase
        .from('shipments')
        .select('id')
        .eq('sales_order_id', matchedId)
        .neq('id', ship.id)
        .limit(1);
      if (existing && existing.length > 0) {
        would_duplicate++;
        pushSample(cafe24OrderId, 'would_duplicate');
        continue;
      }

      if (dry) {
        pushSample(cafe24OrderId, 'matched(dry)');
        continue;
      }

      const { error: updateError } = await supabase
        .from('shipments')
        .update({ sales_order_id: matchedId })
        .eq('id', ship.id);

      if (updateError) {
        unmatched_no_order++;
        pushSample(cafe24OrderId, 'update_error:' + updateError.message);
        continue;
      }
      updated++;
      pushSample(cafe24OrderId, 'updated');
    } catch (e) {
      unmatched_no_order++;
      pushSample(cafe24OrderId, 'exception:' + String(e));
    }
  }

  return NextResponse.json({
    dry,
    scanned,
    matched,
    updated,
    unmatched_no_order,
    unmatched_ambiguous,
    would_duplicate,
    samples,
  });
}
