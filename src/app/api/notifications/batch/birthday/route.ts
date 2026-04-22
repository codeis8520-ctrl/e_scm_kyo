/**
 * 생일 축하 알림톡 배치 발송
 *
 * 호출 방법:
 *   GET/POST /api/notifications/batch/birthday
 *   Header: Authorization: Bearer ${CRON_SECRET}
 *
 * 로직:
 *   - customers.birthday의 MM-DD가 오늘과 일치하는 활성 고객 조회
 *   - BIRTHDAY 이벤트 매핑의 auto_trigger_enabled=true 템플릿 자동 발송
 *
 * Vercel Cron 등록 예시 (vercel.json):
 *   { "path": "/api/notifications/batch/birthday", "schedule": "0 0 * * *" }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { triggerEventNotification } from '@/lib/notification-triggers';
import { kstTodayString } from '@/lib/date';

function sbAdmin() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function verifyCronAuth(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // 미설정 시 거부 — 반드시 환경변수 등록 필요
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

async function run(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = sbAdmin() as any;
  // KST 오늘 MM-DD
  const mmdd = kstTodayString().slice(5);

  // 배치 로그 시작
  const { data: logRow } = await supabase
    .from('notification_batch_logs')
    .insert({ batch_type: 'BIRTHDAY', detail: { date: mmdd } })
    .select('id')
    .single();
  const logId = logRow?.id;

  // 생일 고객 조회 — MM-DD 일치 (PostgreSQL to_char)
  const { data: customers } = await supabase
    .from('customers')
    .select('id, name, phone, grade, birthday')
    .eq('is_active', true)
    .not('birthday', 'is', null);

  const todayBirthdays = ((customers || []) as any[]).filter((c: any) => {
    if (!c.birthday) return false;
    try {
      const d = new Date(c.birthday);
      const cmm = String(d.getMonth() + 1).padStart(2, '0');
      const cdd = String(d.getDate()).padStart(2, '0');
      return `${cmm}-${cdd}` === mmdd;
    } catch { return false; }
  });

  let sent = 0, failed = 0, skipped = 0;

  for (const cust of todayBirthdays) {
    if (!cust.phone || !cust.name) { skipped++; continue; }
    try {
      await triggerEventNotification({
        eventType: 'BIRTHDAY',
        customer: { id: cust.id, name: cust.name, phone: cust.phone },
        context: { customerGrade: cust.grade || 'NORMAL' },
        triggerSource: 'SCHEDULED',
      });
      sent++;
    } catch {
      failed++;
    }
  }

  // 배치 로그 완료
  if (logId) {
    await supabase
      .from('notification_batch_logs')
      .update({
        target_count: todayBirthdays.length,
        sent_count: sent,
        failed_count: failed,
        skipped_count: skipped,
        finished_at: new Date().toISOString(),
      })
      .eq('id', logId);
  }

  return NextResponse.json({
    success: true,
    date: mmdd,
    target: todayBirthdays.length,
    sent,
    failed,
    skipped,
  });
}

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
