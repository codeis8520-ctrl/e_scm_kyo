import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getValidAccessToken } from '@/lib/cafe24/token-store';

// 카페24 회원 목록 → customers 일괄 동기화
// /admin/customers는 created_start_date/created_end_date 필수
// 기본: 최근 5년 가입자 전체. body로 { startDate, endDate } 전달 가능
export async function POST(request: Request) {
  const supabase = (await createClient()) as any;

  let body: any = {};
  try { body = await request.json(); } catch { /* 빈 body 허용 */ }

  const today = new Date();
  const fiveYearsAgo = new Date();
  fiveYearsAgo.setFullYear(today.getFullYear() - 5);
  const startDate: string = body.startDate || fiveYearsAgo.toISOString().slice(0, 10);
  const endDate: string = body.endDate || today.toISOString().slice(0, 10);

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

    // 전화 정리: "010-1234-5678" / "01012345678" 형태만 허용
    const normalizePhone = (raw: any): string | null => {
      if (!raw) return null;
      const s = String(raw).trim();
      if (!s) return null;
      const digits = s.replace(/[^0-9]/g, '');
      if (digits.length < 9 || digits.length > 11) return null;
      // 010-XXXX-XXXX 형태로 반환
      if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
      if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
      return digits;
    };

    // 이름이 실제 사람 이름인지 간이 검증: member_id 형태(@k, @n, 숫자+@문자) 거부
    const isValidName = (name: any): boolean => {
      if (!name || typeof name !== 'string') return false;
      const s = name.trim();
      if (!s) return false;
      // "@k", "@n" 등 소셜 로그인 member_id 패턴 배제
      if (/@[a-z]/i.test(s)) return false;
      // 숫자로만 구성된 경우 배제
      if (/^\d+$/.test(s)) return false;
      // 너무 긴 이름(20자 초과)은 member_id일 가능성 높음
      if (s.length > 20) return false;
      return true;
    };

    for (let page = 0; page < MAX_PAGES; page++) {
      // /admin/customers는 cellphone/member_id 단건 검색 전용.
      // 전체 목록은 /admin/customersprivacy 사용 (offset/limit 페이지네이션)
      // unmasking=T 파라미터로 마스킹 해제 (mall.read_privacy_mobile 스코프 필요)
      const fields = 'member_id,name,cellphone,email,created_date,last_login_date';
      const url = `${base}/admin/customersprivacy?limit=${LIMIT}&offset=${offset}&shop_no=${shopNo}` +
        `&created_start_date=${startDate}&created_end_date=${endDate}` +
        `&unmasking=T&fields=${fields}`;
      const res = await fetch(url, { headers, cache: 'no-store' });

      if (!res.ok) {
        const txt = await res.text();
        return NextResponse.json(
          { success: false, error: `카페24 회원 조회 실패: ${res.status} ${txt}` },
          { status: 500 }
        );
      }

      const json = await res.json();
      const members: any[] = json.customersprivacy ?? json.customers ?? [];
      if (members.length === 0) break;

      for (const m of members) {
        total++;
        const memberId: string = m.member_id;
        if (!memberId) { skipped++; continue; }

        // 마스킹/익명 회원은 dummy 데이터로 저장하지 않고 스킵
        const rawName = m.name || m.member_name;
        const rawPhone = normalizePhone(m.cellphone || m.phone);
        const email = m.email || m.member_email || null;

        if (!isValidName(rawName) || !rawPhone) {
          // 실명·전화 없는 회원은 건너뜀 (마스킹 해제 실패 or 소셜 로그인 등)
          skipped++;
          continue;
        }

        const name = String(rawName).trim();
        const phone = rawPhone;

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
      message: `회원 동기화 완료 (${startDate}~${endDate}) — 신규 ${created}명, 업데이트 ${updated}명, 건너뜀 ${skipped}명 (총 ${total}명)`,
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
