import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getValidAccessToken, loadTokens, refreshAccessToken } from '@/lib/cafe24/token-store';
import { kstTodayString, fmtDateKST } from '@/lib/date';

// 카페24 회원 → customers 일괄 동기화
// 전략: customersprivacy → 실패 시 주문 데이터에서 회원 추출 (mall.read_order만으로 가능)
export async function POST(request: Request) {
  const supabase = (await createClient()) as any;

  let body: any = {};
  try { body = await request.json(); } catch { /* 빈 body 허용 */ }

  // KST 기준 "오늘" / "5년 전" 캘린더 date
  const today = new Date();
  const fiveYearsAgo = new Date();
  fiveYearsAgo.setFullYear(today.getFullYear() - 5);
  const startDate: string = body.startDate || fmtDateKST(fiveYearsAgo);
  const endDate: string = body.endDate || kstTodayString();

  const mallId = process.env.CAFE24_MALL_ID;
  if (!mallId) {
    return NextResponse.json({ success: false, error: 'CAFE24_MALL_ID 미설정' }, { status: 400 });
  }

  let accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ success: false, error: '카페24 토큰 만료 — 재인증 필요' }, { status: 401 });
  }

  const shopNo = process.env.CAFE24_SHOP_NO ?? '1';
  const base = `https://${mallId}.cafe24api.com/api/v2`;
  let headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'X-Cafe24-Api-Version': '2026-03-01',
  };

  const tryRefreshToken = async (): Promise<boolean> => {
    try {
      const row = await loadTokens();
      if (!row) return false;
      const refreshed = await refreshAccessToken(row.refresh_token);
      accessToken = refreshed.access_token;
      headers = { ...headers, Authorization: `Bearer ${accessToken}` };
      return true;
    } catch { return false; }
  };

  const normalizePhone = (raw: any): string | null => {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s) return null;
    const digits = s.replace(/[^0-9]/g, '');
    if (digits.length < 9 || digits.length > 11) return null;
    if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
    if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    return digits;
  };

  const isValidName = (name: any): boolean => {
    if (!name || typeof name !== 'string') return false;
    const s = name.trim();
    if (!s || /@[a-z]/i.test(s) || /^\d+$/.test(s) || s.length > 20) return false;
    return true;
  };

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let total = 0;
  let syncMethod = '';

  try {
    // ─── 1차: customersprivacy API 시도 ───
    const privacyResult = await tryCustomersPrivacy(
      base, shopNo, startDate, endDate, headers, tryRefreshToken
    );

    // 1차가 "성공 + 회원 ≥ 1명"이어야 신뢰. 200 OK + 빈 배열은 권한 부족이
    // 명시적 403이 아니라 silent empty로 응답되는 경우가 잦아, 폴백 미트리거의
    // 원인이었음. 여기선 성공·실패와 무관하게 결과가 비면 주문 폴백으로 진행.
    if (privacyResult.success && privacyResult.members.length > 0) {
      syncMethod = 'customersprivacy';
      // customersprivacy 성공 → 회원 데이터 처리
      for (const m of privacyResult.members) {
        total++;
        const memberId: string = m.member_id;
        if (!memberId) { skipped++; continue; }

        const rawName = m.name || m.member_name;
        const rawPhone = normalizePhone(m.cellphone || m.phone);
        const email = m.email || m.member_email || null;

        if (!isValidName(rawName) || !rawPhone) { skipped++; continue; }

        const result = await upsertCustomer(supabase, {
          name: String(rawName).trim(),
          phone: rawPhone,
          email,
          cafe24_member_id: memberId,
        });
        if (result === 'created') created++;
        else if (result === 'updated') updated++;
        else skipped++;
      }
    } else {
      // ─── 2차: 주문 데이터에서 회원 추출 (mall.read_order만 필요) ───
      // privacyResult.success=true 인데 members.length=0인 경우도 여기로 떨어짐.
      syncMethod = privacyResult.success
        ? 'orders (privacy 빈 응답 폴백)'
        : 'orders (privacy 실패 폴백)';
      const members = await extractMembersFromOrders(
        base, shopNo, startDate, endDate, headers
      );

      for (const m of members.values()) {
        total++;
        const rawPhone = normalizePhone(m.phone);
        if (!isValidName(m.name) || !rawPhone) { skipped++; continue; }

        const result = await upsertCustomer(supabase, {
          name: m.name,
          phone: rawPhone,
          email: m.email || null,
          cafe24_member_id: m.member_id,
        });
        if (result === 'created') created++;
        else if (result === 'updated') updated++;
        else skipped++;
      }
    }

    await supabase.from('cafe24_sync_logs').insert({
      sync_type: 'member_batch_sync',
      cafe24_order_id: 'batch',
      data: { total, created, updated, skipped, syncMethod },
      status: 'success',
      processed_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      message: `회원 동기화 완료 (${syncMethod}) — 신규 ${created}명, 업데이트 ${updated}명, 건너뜀 ${skipped}명 (총 ${total}명)`,
      detail: { total, created, updated, skipped, syncMethod },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// customersprivacy API 시도
async function tryCustomersPrivacy(
  base: string, shopNo: string, startDate: string, endDate: string,
  headers: Record<string, string>, tryRefreshToken: () => Promise<boolean>
): Promise<{ success: boolean; members: any[] }> {
  const LIMIT = 100;
  const MAX_PAGES = 200;
  let offset = 0;
  const allMembers: any[] = [];
  let tokenRefreshed = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    const fields = 'member_id,name,cellphone,email,created_date,last_login_date';
    let url = `${base}/admin/customersprivacy?limit=${LIMIT}&offset=${offset}&shop_no=${shopNo}` +
      `&created_start_date=${startDate}&created_end_date=${endDate}&fields=${fields}`;

    let res = await fetch(url, { headers, cache: 'no-store' });

    if (res.status === 401 && !tokenRefreshed) {
      if (await tryRefreshToken()) {
        tokenRefreshed = true;
        res = await fetch(url, { headers, cache: 'no-store' });
      }
    }

    // 403 → customersprivacy 사용 불가
    if (res.status === 403) {
      return { success: false, members: [] };
    }

    if (!res.ok) {
      return { success: false, members: [] };
    }

    const json = await res.json();
    const members: any[] = json.customersprivacy ?? [];
    if (members.length === 0) break;

    allMembers.push(...members);
    if (members.length < LIMIT) break;
    offset += LIMIT;
  }

  return { success: true, members: allMembers };
}

// 주문 데이터에서 고유 회원 추출 (mall.read_order 스코프만 필요)
// 목록 API 응답에는 주문자 전화번호가 없어, 신규 member_id를 만날 때만
// 상세 API(embed=buyer) + receivers 엔드포인트로 보강 조회한다.
async function extractMembersFromOrders(
  base: string, shopNo: string, startDate: string, endDate: string,
  headers: Record<string, string>
): Promise<Map<string, { member_id: string; name: string; phone: string; email: string | null }>> {
  const members = new Map<string, { member_id: string; name: string; phone: string; email: string | null }>();
  const LIMIT = 100;
  const MAX_PAGES = 100; // 최대 1만 주문

  // 날짜를 월 단위로 분할 (카페24 주문 API 최대 조회 기간 제한 대응)
  const dateRanges = splitDateRanges(startDate, endDate);

  for (const range of dateRanges) {
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${base}/admin/orders?start_date=${range.start}&end_date=${range.end}` +
        `&limit=${LIMIT}&offset=${offset}&shop_no=${shopNo}`;

      const res = await fetch(url, { headers, cache: 'no-store' });
      if (!res.ok) break;

      const json = await res.json();
      const orders: any[] = json.orders ?? [];
      if (orders.length === 0) break;

      for (const order of orders) {
        const memberId = order.member_id;
        if (!memberId || members.has(memberId)) continue;

        const orderId = String(order.order_id ?? '');
        if (!orderId) continue;

        // 이름 1차: 목록 응답의 billing_name (결제자명)
        let name: string = order.billing_name || '';
        let phone = '';
        let email: string | null = null;

        // 상세 API로 buyer 객체 + billing_* 보강
        try {
          const detailRes = await fetch(
            `${base}/admin/orders/${orderId}?shop_no=${shopNo}&embed=buyer`,
            { headers, cache: 'no-store' }
          );
          if (detailRes.ok) {
            const detailJson = await detailRes.json();
            const d = detailJson?.order;
            const buyer = d?.buyer;
            name = buyer?.name || d?.billing_name || d?.orderer_name || name;
            phone = buyer?.cellphone || buyer?.phone
              || d?.billing_cellphone || d?.billing_phone
              || d?.orderer_cellphone || d?.orderer_phone || '';
            email = buyer?.email || d?.billing_email || d?.orderer_email || null;
          }
        } catch { /* 상세 조회 실패는 무시 — receivers 폴백으로 진행 */ }

        // 전화번호 폴백: 수령인(receivers) cellphone (주문자 ≈ 수령인인 경우가 많음)
        if (!phone) {
          try {
            const recvRes = await fetch(
              `${base}/admin/orders/${orderId}/receivers?shop_no=${shopNo}`,
              { headers, cache: 'no-store' }
            );
            if (recvRes.ok) {
              const recvJson = await recvRes.json();
              const recv = recvJson?.receivers?.[0];
              phone = recv?.cellphone || recv?.phone || '';
              if (!name) name = recv?.name || '';
            }
          } catch { /* 무시 */ }
        }

        if (name && phone) {
          members.set(memberId, { member_id: memberId, name, phone, email });
        }
      }

      if (orders.length < LIMIT) break;
      offset += LIMIT;
    }
  }

  return members;
}

// 날짜 범위를 3개월 단위로 분할
function splitDateRanges(startDate: string, endDate: string): { start: string; end: string }[] {
  const ranges: { start: string; end: string }[] = [];
  const end = new Date(endDate + 'T00:00:00');
  let current = new Date(startDate + 'T00:00:00');

  while (current <= end) {
    const rangeEnd = new Date(current);
    rangeEnd.setMonth(rangeEnd.getMonth() + 3);
    rangeEnd.setDate(rangeEnd.getDate() - 1);

    const actualEnd = rangeEnd > end ? end : rangeEnd;
    ranges.push({
      start: current.toISOString().split('T')[0],
      end: actualEnd.toISOString().split('T')[0],
    });

    current = new Date(actualEnd);
    current.setDate(current.getDate() + 1);
  }

  return ranges;
}

// 고객 upsert (cafe24_member_id 기준)
async function upsertCustomer(
  supabase: any,
  data: { name: string; phone: string; email: string | null; cafe24_member_id: string }
): Promise<'created' | 'updated' | 'skipped'> {
  const { data: existing } = await supabase
    .from('customers')
    .select('id')
    .eq('cafe24_member_id', data.cafe24_member_id)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('customers')
      .update({ name: data.name, phone: data.phone, email: data.email })
      .eq('id', existing.id);
    return 'updated';
  } else {
    const { error } = await supabase
      .from('customers')
      .insert({
        name: data.name,
        phone: data.phone,
        email: data.email,
        cafe24_member_id: data.cafe24_member_id,
        grade: 'NORMAL',
        is_active: true,
      });
    return error ? 'skipped' : 'created';
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
