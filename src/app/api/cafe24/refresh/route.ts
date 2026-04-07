import { NextResponse } from 'next/server';
import { loadTokens, refreshAccessToken } from '@/lib/cafe24/token-store';

// Vercel Cron Job이 매일 호출 — refresh_token 갱신으로 14일 만료 방지
// Authorization 헤더로 CRON_SECRET 검증
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const row = await loadTokens();

  if (!row) {
    return NextResponse.json({ success: false, message: '저장된 토큰 없음 — 초기 인증 필요' }, { status: 200 });
  }

  // refresh_token 만료까지 남은 시간 확인
  const refreshExpiresAt = new Date(row.refresh_token_expires_at).getTime();
  const daysLeft = Math.floor((refreshExpiresAt - Date.now()) / (1000 * 60 * 60 * 24));

  try {
    const refreshed = await refreshAccessToken(row.refresh_token);
    return NextResponse.json({
      success: true,
      message: `토큰 갱신 완료 (기존 refresh_token 만료까지 ${daysLeft}일 남은 시점에 갱신)`,
      access_token_preview: refreshed.access_token?.slice(0, 8) + '...',
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      message: `갱신 실패: ${err.message} — 수동 재인증 필요`,
      days_until_refresh_expiry: daysLeft,
    }, { status: 200 });
  }
}
