/**
 * 카페24 결제완료 주문 자동 매출 동기화
 *
 * 매일 크론에서 호출 — 최근 3일 기간의 결제완료 주문을 자동 동기화.
 * 중복 방지: cafe24_order_id 기준 기존 주문은 스킵.
 *
 * 호출: GET /api/cafe24/sync-orders
 * 인증: Authorization: Bearer ${CRON_SECRET}
 * 파라미터: ?days=3 (기본 3일, 최대 30일)
 */

import { NextRequest, NextResponse } from 'next/server';
import { syncCafe24PaidOrders } from '@/lib/cafe24-actions';

export async function GET(req: NextRequest) {
  // CRON_SECRET 검증
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET 미설정' }, { status: 500 });
  }
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const days = Math.min(
    parseInt(req.nextUrl.searchParams.get('days') || '3', 10) || 3,
    30
  );

  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    const result = await syncCafe24PaidOrders({ startDate, endDate });
    return NextResponse.json({
      success: result.success,
      message: result.message,
      processed: result.processed,
      period: { startDate, endDate, days },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'sync failed' }, { status: 500 });
  }
}
