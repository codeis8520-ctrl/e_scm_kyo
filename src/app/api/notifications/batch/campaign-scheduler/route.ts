/**
 * 캠페인 예약 발송 스케줄러
 *
 * GitHub Actions cron이 10분 간격으로 호출.
 * 대상: status='ACTIVE' AND auto_send=true AND sent_at IS NULL
 *       AND scheduled_at IS NOT NULL AND scheduled_at <= now()
 *
 * 호출:
 *   GET /api/notifications/batch/campaign-scheduler
 *   Header: Authorization: Bearer ${CRON_SECRET}
 *
 * 결과는 notification_batch_logs 에 batch_type='CAMPAIGN_SCHEDULER' 로 기록.
 * 개별 캠페인 발송 성공/실패는 sendCampaignCore 내부에서 notifications 테이블에 기록됨.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { sendCampaignCore } from '@/lib/campaign-send-core';

function sbAdmin() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

async function run(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = sbAdmin() as any;
  const now = new Date();

  const { data: logRow } = await supabase
    .from('notification_batch_logs')
    .insert({ batch_type: 'CAMPAIGN_SCHEDULER', detail: { invoked_at: now.toISOString() } })
    .select('id')
    .single();
  const logId = logRow?.id;

  // 대기 중인 예약 캠페인 조회
  const { data: pending, error: fetchErr } = await supabase
    .from('notification_campaigns')
    .select('id, name, scheduled_at')
    .eq('status', 'ACTIVE')
    .eq('auto_send', true)
    .is('sent_at', null)
    .not('scheduled_at', 'is', null)
    .lte('scheduled_at', now.toISOString())
    .order('scheduled_at', { ascending: true });

  if (fetchErr) {
    if (logId) {
      await supabase
        .from('notification_batch_logs')
        .update({
          target_count: 0,
          failed_count: 0,
          sent_count: 0,
          finished_at: new Date().toISOString(),
          detail: { error: fetchErr.message },
        })
        .eq('id', logId);
    }
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const campaigns = (pending || []) as any[];
  let sent = 0;
  let failed = 0;
  const results: Array<{ id: string; name: string; success: boolean; message?: string; sent?: number; fail?: number }> = [];

  for (const c of campaigns) {
    const r = await sendCampaignCore({ campaignId: c.id, sentByUserId: null, supabase });
    if (r.success) {
      sent++;
      results.push({ id: c.id, name: c.name, success: true, sent: r.successCount, fail: r.failCount });
    } else {
      failed++;
      results.push({ id: c.id, name: c.name, success: false, message: r.error });
    }
  }

  if (logId) {
    await supabase
      .from('notification_batch_logs')
      .update({
        target_count: campaigns.length,
        sent_count: sent,
        failed_count: failed,
        finished_at: new Date().toISOString(),
        detail: { invoked_at: now.toISOString(), results },
      })
      .eq('id', logId);
  }

  return NextResponse.json({
    success: true,
    invoked_at: now.toISOString(),
    target: campaigns.length,
    sent,
    failed,
    results,
  });
}

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
