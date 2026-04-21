'use server';

import { requireSession } from '@/lib/session';
import { loadTokens, refreshAccessToken } from '@/lib/cafe24/token-store';
import { syncCafe24PaidOrdersCore } from '@/lib/cafe24/sync-orders';

// ─── 토큰 수동 갱신 ──────────────────────────────────────────────────────────
export async function refreshCafe24Token() {
  try {
    await requireSession();
  } catch (e: any) {
    return { success: false, message: e.message };
  }

  const row = await loadTokens();
  if (!row) {
    return { success: false, message: '저장된 토큰 없음 — 초기 인증 필요 (/api/cafe24/auth)' };
  }

  const refreshExpiresAt = new Date(row.refresh_token_expires_at).getTime();
  const daysLeft = Math.floor((refreshExpiresAt - Date.now()) / (1000 * 60 * 60 * 24));

  try {
    const refreshed = await refreshAccessToken(row.refresh_token);
    return {
      success: true,
      message: `토큰 갱신 완료 (refresh_token 만료 ${daysLeft}일 전 시점)`,
      access_token_preview: refreshed.access_token?.slice(0, 8) + '...',
    };
  } catch (err: any) {
    return { success: false, message: `갱신 실패: ${err.message} — 수동 재인증 필요` };
  }
}

// ─── 결제완료 주문 매출 동기화 (UI/AI 경로) ───────────────────────────────
// 세션 검증 후 순수 로직 위임. 크론은 이 래퍼가 아니라 core를 직접 호출.
export async function syncCafe24PaidOrders(params: { startDate: string; endDate: string }) {
  try {
    await requireSession();
  } catch (e: any) {
    return { success: false, message: e.message, processed: 0 };
  }
  return syncCafe24PaidOrdersCore(params);
}
