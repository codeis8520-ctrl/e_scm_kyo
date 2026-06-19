/**
 * 시간 기반 자동 배송완료 배치 — SHIPPED+송장 건의 updated_at 경과로 DELIVERED 자동(추정 마킹).
 *
 * 외부 택배 추적 API를 호출하지 않는다. SHIPPED + 송장번호 있는 배송건 중
 *   updated_at <= now - N일인 건을 배달완료로 "추정"하여
 *   shipments.status='DELIVERED' + 판매현황 수령상태=RECEIVED(#19 syncReceiptStatusFromShipment) 자동 반영.
 *
 * 호출: GET /api/shipping/track-sync?days=3&limit=50   (GitHub Actions 크론 15:00 KST)
 * 인증: Authorization: Bearer ${CRON_SECRET}
 *
 * 지연일수 N: ?days 파라미터 > SHIPPING_AUTODELIVER_DAYS env > 기본 3. 1 미만이면 3으로 클램프.
 * 기준 타임스탬프 = shipments.updated_at. ⚠️ 배송건을 편집하면 updated_at이 리셋되어
 *   자동완료 시계가 다시 시작된다(의도된 보수적 동작). 별도 shipped_at 컬럼은 두지 않음.
 * 멱등: status='SHIPPED' 필터 자체가 DELIVERED/취소/반품 건을 제외하므로 재처리 없음.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { syncReceiptStatusFromShipment } from '@/lib/receipt-sync';

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET 미설정' }, { status: 500 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 지연일수 N: ?days > env SHIPPING_AUTODELIVER_DAYS > 3. parseInt 실패/1미만이면 3.
  const rawDays = req.nextUrl.searchParams.get('days') ?? process.env.SHIPPING_AUTODELIVER_DAYS;
  const parsedDays = parseInt(rawDays || '', 10);
  const days = Number.isFinite(parsedDays) && parsedDays >= 1 ? parsedDays : 3;

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '40', 10) || 40, 200);

  const cutoffIso = new Date(Date.now() - days * 86400000).toISOString();

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // SHIPPED + 송장 있고 updated_at가 N일 경과한 건 (오래된 발송부터)
  const { data: ships, error } = await supabase
    .from('shipments')
    .select('id, tracking_number, sales_order_id, cafe24_order_id')
    .eq('status', 'SHIPPED')
    .not('tracking_number', 'is', null)
    .lte('updated_at', cutoffIso)
    .order('updated_at', { ascending: true })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const candidates = (ships as any[])?.length ?? 0;
  let delivered = 0;

  for (const s of (ships as any[]) ?? []) {
    await supabase.from('shipments')
      .update({ status: 'DELIVERED', updated_at: new Date().toISOString() })
      .eq('id', s.id);

    // 판매현황 수령상태 자동 반영(#19). sales_order_id 없으면 cafe24_order_id로 해소.
    let soId: string | null = s.sales_order_id ?? null;
    if (!soId && s.cafe24_order_id) {
      const { data: so } = await supabase
        .from('sales_orders').select('id').eq('cafe24_order_id', String(s.cafe24_order_id)).maybeSingle();
      soId = so?.id ?? null;
    }
    if (soId) {
      try { await syncReceiptStatusFromShipment(supabase, soId, 'DELIVERED'); } catch { /* noop */ }
    }
    delivered++;
  }

  return NextResponse.json({
    delivered, candidates, days,
    message: `${days}일 경과 자동 배송완료(추정) ${delivered}건`,
  });
}
