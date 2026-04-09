/**
 * 휴면 고객 재유치 알림톡 배치
 *
 * 쿼리 파라미터:
 *   - days: 휴면 기준 일수 (기본 90)
 *   - limit: 1회 발송 최대 건수 (기본 100)
 *
 * 로직:
 *   - 최근 N일간 COMPLETED 주문이 없는 활성 고객
 *   - DORMANT 이벤트 매핑의 auto_trigger_enabled=true 템플릿 자동 발송
 *   - 최근 30일 내 이미 DORMANT 알림톡을 받은 고객은 제외 (중복 발송 방지)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { triggerEventNotification } from '@/lib/notification-triggers';

function sbAdmin() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // 미설정 시 거부
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

async function run(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const days = parseInt(searchParams.get('days') || '90', 10);
  const limit = parseInt(searchParams.get('limit') || '100', 10);

  const supabase = sbAdmin() as any;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffIso = cutoffDate.toISOString();

  const recentBlockDate = new Date();
  recentBlockDate.setDate(recentBlockDate.getDate() - 30);
  const recentBlockIso = recentBlockDate.toISOString();

  const { data: logRow } = await supabase
    .from('notification_batch_logs')
    .insert({ batch_type: 'DORMANT', detail: { days, limit } })
    .select('id')
    .single();
  const logId = logRow?.id;

  // 1) 최근 주문한 고객 ID 집합
  const { data: recentOrders } = await supabase
    .from('sales_orders')
    .select('customer_id')
    .gte('ordered_at', cutoffIso)
    .eq('status', 'COMPLETED')
    .not('customer_id', 'is', null);
  const activeIds = new Set(((recentOrders || []) as any[]).map(r => r.customer_id));

  // 2) 전체 활성 고객
  const { data: allCust } = await supabase
    .from('customers')
    .select('id, name, phone, grade')
    .eq('is_active', true);

  // 3) 휴면 후보
  const dormantCandidates = ((allCust || []) as any[])
    .filter(c => !activeIds.has(c.id) && c.name && c.phone)
    .slice(0, limit);

  // 4) 최근 30일 내 DORMANT 알림톡 받은 고객 제외
  const dormantIds = dormantCandidates.map(c => c.id);
  if (dormantIds.length > 0) {
    const { data: recentDormantNotif } = await supabase
      .from('notifications')
      .select('customer_id')
      .in('customer_id', dormantIds)
      .eq('notification_type', 'KAKAO')
      .eq('status', 'sent')
      .gte('sent_at', recentBlockIso);
    const alreadySent = new Set(((recentDormantNotif || []) as any[]).map(n => n.customer_id));
    for (let i = dormantCandidates.length - 1; i >= 0; i--) {
      if (alreadySent.has(dormantCandidates[i].id)) {
        dormantCandidates.splice(i, 1);
      }
    }
  }

  let sent = 0, failed = 0, skipped = 0;

  for (const cust of dormantCandidates) {
    try {
      await triggerEventNotification({
        eventType: 'DORMANT',
        customer: { id: cust.id, name: cust.name, phone: cust.phone },
        context: { customerGrade: cust.grade || 'NORMAL' },
        triggerSource: 'SCHEDULED',
      });
      sent++;
    } catch {
      failed++;
    }
  }

  if (logId) {
    await supabase
      .from('notification_batch_logs')
      .update({
        target_count: dormantCandidates.length,
        sent_count: sent,
        failed_count: failed,
        skipped_count: skipped,
        finished_at: new Date().toISOString(),
      })
      .eq('id', logId);
  }

  return NextResponse.json({
    success: true,
    days,
    target: dormantCandidates.length,
    sent,
    failed,
    skipped,
  });
}

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
