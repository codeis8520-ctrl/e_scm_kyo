/**
 * 과거 카페24 주문 total_amount 인플레이스 백필 (1회성 운영 트리거)
 *
 * 이미 동기화된 과거 sales_orders(channel='ONLINE')의 total_amount를 cafe24 재조회 →
 * cafe24OrderTotal(모든 tender 합) 재계산 → 현재값과 다르면 total_amount만 인플레이스 update.
 * 네이버페이 포인트 등 누락 tender로 금액이 낮게 잡힌 건을 보정한다.
 * discount_amount/payment_method/recipient/items/customer/status 무손상.
 *
 * 호출: GET /api/cafe24/backfill-amount?offset=0&limit=20  (limit 기본 20, 최대 50)
 * 인증: Authorization: Bearer ${CRON_SECRET}
 *
 * 멱등 — 같은 값이면 skip(unchanged). 건별 try/catch로 한 건 실패가 배치 전체를 멈추지 않음.
 * 취소/환불 주문(CANCELLED/REFUNDED/PARTIALLY_REFUNDED)은 대상 제외.
 *
 * Known Gap (회계 무조정): total_amount가 바뀌어도 createSaleJournal 재게시/조정은 하지 않는다.
 *   journal_entries 불일치는 별도 처리.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Cafe24Client } from '@/lib/cafe24/client';
import { getValidAccessToken } from '@/lib/cafe24/token-store';
import { cafe24OrderTotal } from '@/lib/cafe24/types';

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

  const offset = Math.max(parseInt(req.nextUrl.searchParams.get('offset') || '0', 10) || 0, 0);
  const limit = Math.min(
    parseInt(req.nextUrl.searchParams.get('limit') || '20', 10) || 20,
    50
  );

  const supabase = getSupabase();

  // 토큰 주입 (앱 컨텍스트 DB 토큰). null이면 처리 0으로 401 종료.
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json(
      { error: 'No valid Cafe24 access token — 토큰 갱신/재인증 필요' },
      { status: 401 }
    );
  }
  const client = new Cafe24Client(
    process.env.CAFE24_MALL_ID || '',
    process.env.CAFE24_CLIENT_ID || '',
    process.env.CAFE24_CLIENT_SECRET || ''
  );
  client.setTokens({
    access_token: accessToken,
    refresh_token: '',
    expires_at: Date.now() + 60 * 60 * 1000,
    token_type: 'Bearer',
  });

  // 대상: channel='ONLINE' AND cafe24_order_id NOT NULL AND 취소/환불 제외 — 전체.
  //   금액 틀린 건은 recipient/memo가 정상일 수 있어 깨짐필터(/backfill)는 쓰지 않는다.
  //   ordered_at desc 안정 정렬 + offset 페이지네이션으로 전량 처리.
  const { data: candidates, error: queryError } = await supabase
    .from('sales_orders')
    .select('id, cafe24_order_id, total_amount')
    .eq('channel', 'ONLINE')
    .not('cafe24_order_id', 'is', null)
    .not('status', 'in', '(CANCELLED,REFUNDED,PARTIALLY_REFUNDED)')
    .order('ordered_at', { ascending: false })
    .order('id', { ascending: true })  // 안정 정렬 — offset 페이지 경계 흔들림 방지
    .range(offset, offset + limit - 1);

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  let scanned = 0;
  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  const failedOrderNos: string[] = [];

  for (const row of candidates ?? []) {
    scanned++;
    const cafe24OrderId = row.cafe24_order_id as string;
    try {
      const orderResponse = await client.getOrder(cafe24OrderId);
      if (!orderResponse.success || !orderResponse.data) {
        failed++;
        if (failedOrderNos.length < 20) failedOrderNos.push(cafe24OrderId);
        continue;
      }

      const newTotal = cafe24OrderTotal(orderResponse.data);
      const currentTotal = Number(row.total_amount);

      if (newTotal === currentTotal) {
        unchanged++;
        continue;
      }

      const { error: updateError } = await supabase
        .from('sales_orders')
        .update({ total_amount: newTotal })
        .eq('id', row.id);

      if (updateError) {
        failed++;
        if (failedOrderNos.length < 20) failedOrderNos.push(cafe24OrderId);
        continue;
      }

      updated++;
    } catch {
      failed++;
      if (failedOrderNos.length < 20) failedOrderNos.push(cafe24OrderId);
    }
  }

  const done = scanned < limit;

  return NextResponse.json({
    scanned,
    updated,
    unchanged,
    failed,
    ...(failedOrderNos.length > 0 ? { failedOrderNos } : {}),
    ...(scanned === limit ? { nextOffset: offset + limit } : {}),
    done,
  });
}
