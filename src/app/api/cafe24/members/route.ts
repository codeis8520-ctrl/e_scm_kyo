import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { Cafe24Member } from '@/lib/cafe24/types';

export async function POST() {
  const supabase = await createClient() as any;
  
  try {
    const mallId = process.env.CAFE24_MALL_ID;
    const clientId = process.env.CAFE24_CLIENT_ID;
    const clientSecret = process.env.CAFE24_CLIENT_SECRET;

    const isDemo = !mallId || !clientId || !clientSecret;

    if (isDemo) {
      console.log('Cafe24 데모 모드: 샘플 데이터로 동기화 진행');
    }

    // Demo용: 샘플 회원 데이터 (실제 API 연동 시 Cafe24 API 호출로 대체)
    const members: Cafe24Member[] = [
      { member_id: 'demo_user_001', member_name: '홍길동', member_email: 'hong@example.com', member_phone: '010-1234-5678', created_date: '2024-01-15' },
      { member_id: 'demo_user_002', member_name: '김철수', member_email: 'kim@example.com', member_phone: '010-2345-6789', created_date: '2024-02-20' },
      { member_id: 'demo_user_003', member_name: '이영희', member_email: 'lee@example.com', member_phone: '010-3456-7890', created_date: '2024-03-10' },
    ];

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const member of members) {
      const existing = await supabase
        .from('customers')
        .select('id, name, cafe24_member_id')
        .eq('cafe24_member_id', member.member_id)
        .single();

      if (existing.data) {
        await supabase
          .from('customers')
          .update({
            name: member.member_name,
            email: member.member_email || null,
            phone: member.member_phone || member.member_cellphone || null,
            source: 'CAFE24',
          })
          .eq('id', existing.data.id);
        updated++;
      } else {
        const { error } = await supabase
          .from('customers')
          .insert({
            name: member.member_name,
            email: member.member_email || null,
            phone: member.member_phone || member.member_cellphone || `cafe24_${member.member_id}`,
            cafe24_member_id: member.member_id,
            grade: 'NORMAL',
            source: 'CAFE24',
          });

        if (error) {
          console.error(`회원 생성 실패: ${member.member_id}`, error);
          skipped++;
        } else {
          created++;
        }
      }
    }

    await supabase.from('cafe24_sync_logs').insert({
      sync_type: 'member_batch_sync',
      cafe24_order_id: 'batch',
      data: { total: members.length, created, updated, skipped },
      status: 'success',
      processed_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      message: `동기화 완료: ${created}명 생성, ${updated}명 업데이트, ${skipped}명 건너뜀`,
      detail: { total: members.length, created, updated, skipped },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function GET() {
  const supabase = await createClient() as any;
  
  try {
    const logs = await supabase
      .from('cafe24_sync_logs')
      .select('*')
      .eq('sync_type', 'member_batch_sync')
      .order('processed_at', { ascending: false })
      .limit(10);

    const { count } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })
      .not('cafe24_member_id', 'is', null);

    return NextResponse.json({
      syncedCustomers: count || 0,
      recentLogs: logs.data || [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
