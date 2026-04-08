import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getValidAccessToken } from '@/lib/cafe24/token-store';

// 카페24 회원 목록 → customers 일괄 동기화
// 페이지네이션으로 전체 회원을 가져와 cafe24_member_id 기준 upsert
export async function POST() {
  const supabase = (await createClient()) as any;

  const mallId = process.env.CAFE24_MALL_ID;
  if (!mallId) {
    return NextResponse.json({ success: false, error: 'CAFE24_MALL_ID 미설정' }, { status: 400 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ success: false, error: '카페24 토큰 만료 — 재인증 필요' }, { status: 401 });
  }

  const shopNo = process.env.CAFE24_SHOP_NO ?? '1';
  const base = `https://${mallId}.cafe24api.com/api/v2`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'X-Cafe24-Api-Version': '2026-03-01',
  };

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let total = 0;

  try {
    // 카페24 customers API 페이지네이션 (최대 100건/페이지)
    const LIMIT = 100;
    const MAX_PAGES = 200; // 안전장치 (최대 2만명)
    let offset = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${base}/admin/customers?limit=${LIMIT}&offset=${offset}&shop_no=${shopNo}`;
      const res = await fetch(url, { headers, cache: 'no-store' });

      if (!res.ok) {
        const txt = await res.text();
        return NextResponse.json(
          { success: false, error: `카페24 회원 조회 실패: ${res.status} ${txt}` },
          { status: 500 }
        );
      }

      const json = await res.json();
      const members: any[] = json.customers ?? [];
      if (members.length === 0) break;

      for (const m of members) {
        total++;
        const memberId: string = m.member_id;
        if (!memberId) { skipped++; continue; }

        const name = m.member_name || m.name || `고객_${memberId}`;
        const email = m.email || m.member_email || null;
        const phone = m.cellphone || m.phone || `cafe24_${memberId}`;

        const { data: existing } = await supabase
          .from('customers')
          .select('id')
          .eq('cafe24_member_id', memberId)
          .maybeSingle();

        if (existing) {
          await supabase
            .from('customers')
            .update({ name, email, phone })
            .eq('id', existing.id);
          updated++;
        } else {
          const { error } = await supabase
            .from('customers')
            .insert({
              name,
              email,
              phone,
              cafe24_member_id: memberId,
              grade: 'NORMAL',
              is_active: true,
            });
          if (error) skipped++;
          else created++;
        }
      }

      if (members.length < LIMIT) break;
      offset += LIMIT;
    }

    await supabase.from('cafe24_sync_logs').insert({
      sync_type: 'member_batch_sync',
      cafe24_order_id: 'batch',
      data: { total, created, updated, skipped },
      status: 'success',
      processed_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      message: `회원 동기화 완료 — 신규 ${created}명, 업데이트 ${updated}명, 건너뜀 ${skipped}명 (총 ${total}명)`,
      detail: { total, created, updated, skipped },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  const supabase = (await createClient()) as any;
  const { count } = await supabase
    .from('customers')
    .select('*', { count: 'exact', head: true })
    .not('cafe24_member_id', 'is', null);
  return NextResponse.json({ syncedCustomers: count || 0 });
}
