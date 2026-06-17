/**
 * 배송완료 자동추적 배치 (#26) — 송장 기반 SweetTracker 추적 → 배달완료 자동 반영.
 *
 * SHIPPED + 송장번호 있는 배송건을 스마트택배로 조회해 배달완료(level 6)면
 *   shipments.status='DELIVERED' + 판매현황 수령상태=RECEIVED(#19 syncReceiptStatusFromShipment) 자동 반영.
 *
 * 호출: GET /api/shipping/track-sync?limit=50   (GitHub Actions 크론)
 * 인증: Authorization: Bearer ${CRON_SECRET}
 *
 * 쿼터 보호: 배치당 limit(기본 40, 최대 80) + 건당 짧은 딜레이. 429면 즉시 중단.
 * t_code=04(CJ대한통운) 고정 — 현재 전 배송이 CJ.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { syncReceiptStatusFromShipment } from '@/lib/receipt-sync';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchDelivered(apiKey: string, trackingNo: string): Promise<'DELIVERED' | 'SHIPPED' | 'ERROR' | 'QUOTA'> {
  try {
    const url = `https://info.sweettracker.co.kr/api/v1/trackingInfo?t_key=${apiKey}&t_code=04&t_invoice=${encodeURIComponent(trackingNo)}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (res.status === 429) return 'QUOTA';
    if (!res.ok) return 'ERROR';
    const data = await res.json();
    if (data.status === false || data.msg) return 'ERROR';
    return data.level === 6 ? 'DELIVERED' : 'SHIPPED';
  } catch {
    return 'ERROR';
  }
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET 미설정' }, { status: 500 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.SWEETTRACKER_API_KEY;
  // 키 미설정이면 실패(500)가 아니라 건너뜀(200) — 일일 크론이 false 실패로 뜨지 않게.
  //   추후 SWEETTRACKER_API_KEY 등록 시 코드 변경 없이 자동 작동.
  if (!apiKey) {
    return NextResponse.json({ skipped: true, message: 'SWEETTRACKER_API_KEY 미설정 — 자동추적 건너뜀(수동 배송완료 사용)' });
  }

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '40', 10) || 40, 80);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // SHIPPED + 송장 있는 건 (오래된 발송부터)
  const { data: ships, error } = await supabase
    .from('shipments')
    .select('id, tracking_number, sales_order_id, cafe24_order_id')
    .eq('status', 'SHIPPED')
    .not('tracking_number', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let checked = 0, delivered = 0, failed = 0;
  let quota = false;

  for (const s of (ships as any[]) ?? []) {
    checked++;
    const result = await fetchDelivered(apiKey, String(s.tracking_number));
    if (result === 'QUOTA') { quota = true; break; }
    if (result === 'ERROR') { failed++; await sleep(120); continue; }
    if (result === 'DELIVERED') {
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
    await sleep(120); // rate limit 완화
  }

  return NextResponse.json({
    checked, delivered, failed,
    ...(quota ? { quotaExceeded: true } : {}),
    message: `추적 ${checked}건 — 배송완료 ${delivered}건 반영, 실패 ${failed}건${quota ? ' (쿼터 초과로 중단)' : ''}`,
  });
}
