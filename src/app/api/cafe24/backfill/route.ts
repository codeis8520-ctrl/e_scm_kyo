/**
 * 과거 카페24 주문 인플레이스 백필 (1회성 운영 트리거)
 *
 * 이미 동기화된 과거 sales_orders(channel='ONLINE') 중 깨진 건
 * (품목 0종 / memo='Delivery: undefined...' / recipient_name 빈값)을 삭제 없이
 * cafe24 재조회로 memo·recipient_*·sales_order_items를 인플레이스 보정한다.
 * FK(customer_id·환불·분개) 및 금액·주문자·상태 무손상. 재고/movements/point_history 없음.
 *
 * 호출: GET /api/cafe24/backfill?limit=50  (기본 50, 최대 200)
 * 인증: Authorization: Bearer ${CRON_SECRET}
 *
 * 멱등 — 반복 호출로 점진 처리(이미 정상인 건 skip). 건별 try/catch로 한 건 실패가
 * 배치 전체를 멈추지 않음. 취소/환불 주문은 대상 제외.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { Cafe24Client } from '@/lib/cafe24/client';
import { getValidAccessToken } from '@/lib/cafe24/token-store';
import { extractRecipientInfo, syncCafe24OrderItems } from '@/lib/cafe24/webhook';

function getSupabase() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// memo 문자열 규칙 — webhook.ts handleOrderCreated와 동일 재현(주소 없으면 null, 'undefined' 금지).
function buildDeliveryMemo(recipient: { address: string | null; addressDetail: string | null }): string | null {
  return recipient.address
    ? `Delivery: ${[recipient.address, recipient.addressDetail].filter(Boolean).join(' ')}`
    : null;
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

  const limit = Math.min(
    parseInt(req.nextUrl.searchParams.get('limit') || '50', 10) || 50,
    200
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

  // 대상: channel='ONLINE' AND cafe24_order_id NOT NULL AND 취소/환불 제외.
  // 깨짐 판정 = (sales_order_items 0건 OR memo LIKE 'Delivery: undefined%' OR recipient_name NULL).
  //   이 셋은 함께 발생(깨진 주문은 recipient_name NULL이면서 memo undefined이면서 품목0).
  // ⚠️ DB단계 깨짐 필터 필수: 정상 주문(신규 동기화분)이 스캔 앞쪽을 차지하면 limit 캡 안에서
  //    깨진 건에 도달 못 해 진전이 안 됨. recipient_name NULL OR memo LIKE 로 깨진 행만 선별.
  //    보정 후 recipient_name/memo가 채워져 자동으로 대상에서 빠짐 → 반복 호출로 페이지네이션.
  //    (품목만 0건이고 memo/recipient 정상인 잔여 케이스는 본 데이터에 없음 — 동시 발생.)
  const { data: candidates, error: queryError } = await supabase
    .from('sales_orders')
    .select('id, cafe24_order_id, memo, recipient_name, status, sales_order_items(count)')
    .eq('channel', 'ONLINE')
    .not('cafe24_order_id', 'is', null)
    .not('status', 'in', '(CANCELLED,REFUNDED,PARTIALLY_REFUNDED)')
    .or('recipient_name.is.null,memo.like.Delivery: undefined*')
    .order('ordered_at', { ascending: false })
    .limit(limit);

  if (queryError) {
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  let scanned = 0;
  let fixedMemo = 0;
  let fixedRecipient = 0;
  let fixedItems = 0;
  let skipped = 0;
  let failed = 0;
  const failedOrderNos: string[] = [];

  for (const row of candidates ?? []) {
    scanned++;
    const cafe24OrderId = row.cafe24_order_id as string;
    try {
      // 현재 품목 존재여부 (임베드 count, 멱등 판정용).
      const itemCount = Number((row as any).sales_order_items?.[0]?.count ?? 0);
      const hasItems = itemCount > 0;

      const needsMemoFix = row.memo == null || String(row.memo).startsWith('Delivery: undefined');
      const needsRecipientFix = row.recipient_name == null;
      const needsItems = !hasItems;

      if (!needsMemoFix && !needsRecipientFix && !needsItems) {
        skipped++;
        continue;
      }

      // cafe24 재조회 (items/buyer/receivers 임베드 내장).
      const orderResponse = await client.getOrder(cafe24OrderId);
      if (!orderResponse.success || !orderResponse.data) {
        failed++;
        if (failedOrderNos.length < 20) failedOrderNos.push(cafe24OrderId);
        continue;
      }
      const cafe24Order = orderResponse.data;
      const recipient = extractRecipientInfo(cafe24Order);

      let didFix = false;

      // memo + recipient_* 인플레이스 update (깨진 값일 때만).
      if (needsMemoFix || needsRecipientFix) {
        const updatePayload: Record<string, unknown> = {
          memo: buildDeliveryMemo(recipient),
          recipient_name: recipient.name,
          recipient_phone: recipient.phone,
          recipient_zipcode: recipient.zipcode,
          recipient_address: recipient.address,
          recipient_address_detail: recipient.addressDetail,
        };

        let { error: updateError } = await supabase
          .from('sales_orders')
          .update(updatePayload)
          .eq('id', row.id);

        // 마이그 083 미적용 방어(42703): recipient_* 5필드 제거 후 memo만 재시도.
        if (updateError) {
          const code = String((updateError as any).code || '');
          const msg = String(updateError.message || '').toLowerCase();
          if (code === '42703' || msg.includes('recipient_') || (msg.includes('column') && msg.includes('does not exist'))) {
            const retry = await supabase
              .from('sales_orders')
              .update({ memo: buildDeliveryMemo(recipient) })
              .eq('id', row.id);
            updateError = retry.error;
          }
        }

        if (!updateError) {
          if (needsMemoFix) fixedMemo++;
          if (needsRecipientFix) fixedRecipient++;
          didFix = true;
        }
      }

      // 품목 0건이면 생성 (내부 멱등 가드).
      if (needsItems) {
        await syncCafe24OrderItems(row.id, (cafe24Order as any).items ?? [], cafe24OrderId);
        const { data: afterItems } = await supabase
          .from('sales_order_items')
          .select('id')
          .eq('sales_order_id', row.id)
          .limit(1);
        if (afterItems?.length) {
          fixedItems++;
          didFix = true;
        }
      }

      if (!didFix) skipped++;
    } catch {
      failed++;
      if (failedOrderNos.length < 20) failedOrderNos.push(cafe24OrderId);
    }
  }

  return NextResponse.json({
    scanned,
    fixedMemo,
    fixedRecipient,
    fixedItems,
    skipped,
    failed,
    ...(failedOrderNos.length > 0 ? { failedOrderNos } : {}),
  });
}
