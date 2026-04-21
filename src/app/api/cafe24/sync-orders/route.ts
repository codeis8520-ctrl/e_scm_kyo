/**
 * 카페24 결제완료 주문 자동 매출 동기화 (크론 엔드포인트)
 *
 * GitHub Actions cron이 매일 08:00 / 18:00 KST에 호출.
 * 세션 없이 CRON_SECRET Bearer 토큰만으로 인증 — 따라서 세션 의존 함수가 아닌
 * syncCafe24PaidOrdersCore(순수 로직)를 직접 호출한다.
 *
 * 호출: GET /api/cafe24/sync-orders
 * 인증: Authorization: Bearer ${CRON_SECRET}
 * 파라미터: ?days=3 (기본 3일, 최대 30일)
 *
 * 실행 결과는 cafe24_sync_logs에 sync_type='sales_sync'로 요약 1행 기록.
 * success=false 또는 예외 시 HTTP 500 반환 → GitHub Actions가 실패로 표시.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { syncCafe24PaidOrdersCore } from '@/lib/cafe24/sync-orders';

function getSupabase() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

async function logSalesSync(params: {
  status: 'success' | 'error';
  startDate: string;
  endDate: string;
  days: number;
  result?: any;
  errorMessage?: string;
}) {
  try {
    await getSupabase().from('cafe24_sync_logs').insert({
      sync_type: 'sales_sync',
      cafe24_order_id: 'cron',
      data: {
        period: { startDate: params.startDate, endDate: params.endDate, days: params.days },
        result: params.result ?? null,
        error: params.errorMessage ?? null,
        timestamp: new Date().toISOString(),
      },
      status: params.status,
      error_message: params.errorMessage ?? null,
      processed_at: new Date().toISOString(),
    });
  } catch {
    // 로그 저장 실패는 무시 — 동기화 결과가 응답으로 나가는 것이 우선
  }
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

  const days = Math.min(
    parseInt(req.nextUrl.searchParams.get('days') || '3', 10) || 3,
    30
  );

  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    const result = await syncCafe24PaidOrdersCore({ startDate, endDate });

    await logSalesSync({
      status: result.success ? 'success' : 'error',
      startDate,
      endDate,
      days,
      result,
      errorMessage: result.success ? undefined : result.message,
    });

    const body = {
      success: result.success,
      message: result.message,
      processed: result.processed,
      period: { startDate, endDate, days },
    };
    // 실패는 HTTP 500으로 반환해야 GitHub Actions가 실패로 표시한다.
    return NextResponse.json(body, { status: result.success ? 200 : 500 });
  } catch (err: any) {
    const message = err?.message || 'sync failed';
    await logSalesSync({ status: 'error', startDate, endDate, days, errorMessage: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
