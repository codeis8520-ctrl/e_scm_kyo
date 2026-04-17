import { NextResponse } from 'next/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { loadTokens, refreshAccessToken } from '@/lib/cafe24/token-store';

function getSupabase() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Vercel Cron Job이 매일 호출 — refresh_token 갱신으로 14일 만료 방지
// Authorization 헤더로 CRON_SECRET 검증 (Vercel Cron은 자동 주입)
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET 미설정' }, { status: 500 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const row = await loadTokens();

  if (!row) {
    await logRefreshResult('no_token', '저장된 토큰 없음 — /api/cafe24/auth 초기 인증 필요');
    return NextResponse.json({ success: false, message: '저장된 토큰 없음 — 초기 인증 필요' }, { status: 200 });
  }

  const refreshExpiresAt = new Date(row.refresh_token_expires_at).getTime();
  const daysLeft = isNaN(refreshExpiresAt)
    ? null
    : Math.round((refreshExpiresAt - Date.now()) / (1000 * 60 * 60 * 24) * 10) / 10;

  // refresh_token 이미 만료 → 재인증 필요 (expires_at이 없으면 갱신 시도)
  if (daysLeft !== null && daysLeft <= 0) {
    await logRefreshResult('expired', `refresh_token 만료됨 — /api/cafe24/auth 재인증 필요`);
    return NextResponse.json({
      success: false,
      message: 'refresh_token 만료 — /api/cafe24/auth 재인증 필요',
    }, { status: 200 });
  }

  // 1차 시도
  try {
    const refreshed = await refreshAccessToken(row.refresh_token);
    await logRefreshResult('success', `갱신 완료 (만료 ${daysLeft ?? '?'}일 전 갱신)`);
    return NextResponse.json({
      success: true,
      message: `토큰 갱신 완료`,
      access_token_preview: refreshed.access_token?.slice(0, 8) + '...',
      days_until_refresh_expiry: daysLeft,
    });
  } catch (err1: any) {
    // 1차 실패 → 30초 후 재시도
    await new Promise((r) => setTimeout(r, 30000));

    // 최신 토큰 다시 로드 (다른 프로세스가 갱신했을 수 있음)
    const row2 = await loadTokens();
    const retryToken = row2?.refresh_token || row.refresh_token;

    try {
      const refreshed = await refreshAccessToken(retryToken);
      await logRefreshResult('success_retry', `재시도 성공 (1차: ${err1.message})`);
      return NextResponse.json({
        success: true,
        message: `토큰 갱신 완료 (재시도 성공)`,
        access_token_preview: refreshed.access_token?.slice(0, 8) + '...',
      });
    } catch (err2: any) {
      const consecutiveFails = await countConsecutiveFailures();
      await logRefreshResult('failed', `2회 연속 실패: ${err2.message} (연속실패: ${consecutiveFails + 1}회)`);

      return NextResponse.json({
        success: false,
        message: `갱신 2회 실패: ${err2.message}`,
        days_until_refresh_expiry: daysLeft,
        consecutive_failures: consecutiveFails + 1,
        action_required: daysLeft !== null && daysLeft <= 3
          ? '⚠️ 긴급: refresh_token 만료 임박 — /api/cafe24/auth 재인증 필요'
          : `남은 기간: ${daysLeft ?? '알 수 없음'}일`,
      }, { status: 200 });
    }
  }
}

async function logRefreshResult(status: string, message: string) {
  try {
    await getSupabase().from('cafe24_sync_logs').insert({
      sync_type: 'token_refresh',
      cafe24_order_id: 'cron',
      data: { status, message, timestamp: new Date().toISOString() },
      status: status.startsWith('success') ? 'success' : 'error',
      processed_at: new Date().toISOString(),
    });
  } catch {
    // 로그 저장 실패는 무시
  }
}

async function countConsecutiveFailures(): Promise<number> {
  try {
    const { data } = await getSupabase()
      .from('cafe24_sync_logs')
      .select('status')
      .eq('sync_type', 'token_refresh')
      .order('processed_at', { ascending: false })
      .limit(10);

    let count = 0;
    for (const row of data || []) {
      if (row.status === 'error') count++;
      else break;
    }
    return count;
  } catch {
    return 0;
  }
}
