import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getValidAccessToken, loadTokens } from '@/lib/cafe24/token-store';

export async function GET() {
  const mallId = process.env.CAFE24_MALL_ID;
  const clientId = process.env.CAFE24_CLIENT_ID;

  // 0. 토큰 스코프 진단 (회원 동기화 403 디버깅용)
  const tokenRow = await loadTokens();
  const scopeDiag = {
    발급된스코프: (tokenRow as any)?.scopes || '(scopes 컬럼 비어있음)',
    필요한스코프: ['mall.read_order', 'mall.read_customer', 'mall.read_personal'],
    mall_read_personal_포함여부: Array.isArray((tokenRow as any)?.scopes)
      ? (tokenRow as any).scopes.includes('mall.read_personal')
      : '확인불가(scopes가 배열 아님)',
    해결방법: 'mall.read_personal이 없으면: 카페24 개발자 센터 → 내 앱 → 권한 설정에서 추가 후 /api/cafe24/auth 재인증',
  };

  // 1. 환경변수 확인
  const envCheck = {
    CAFE24_MALL_ID: !!mallId,
    CAFE24_CLIENT_ID: !!clientId,
    CAFE24_CLIENT_SECRET: !!process.env.CAFE24_CLIENT_SECRET,
    CAFE24_REDIRECT_URI: process.env.CAFE24_REDIRECT_URI || '(auto)',
  };

  // 2. DB 토큰 확인
  const supabase = await createClient();
  const { data: tokenDbRow, error: tokenError } = await (supabase as any)
    .from('cafe24_tokens')
    .select('mall_id, access_token_expires_at, refresh_token_expires_at, scopes, updated_at')
    .eq('mall_id', mallId)
    .single();

  // 3. 유효 토큰 가져오기 시도
  const accessToken = await getValidAccessToken();

  // 4. 실제 API 호출 테스트
  let apiTest: any = null;
  if (accessToken && mallId) {
    const today = new Date().toISOString().split('T')[0];
    const url = `https://${mallId}.cafe24api.com/api/v2/admin/orders?start_date=${today}&end_date=${today}&limit=10&shop_no=${process.env.CAFE24_SHOP_NO ?? '1'}`;
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Cafe24-Api-Version': '2026-03-01',
        },
      });
      const json = await res.json().catch(() => null);
      const firstOrder = json?.orders?.[0];
      const orderId = firstOrder?.order_id;

      // 단건 주문 상세 API 호출 (수신자/상품 포함)
      let detailTest: any = null;
      if (orderId) {
        const detailUrl = `https://${mallId}.cafe24api.com/api/v2/admin/orders/${orderId}?shop_no=${process.env.CAFE24_SHOP_NO ?? '1'}&embed=items,shippingaddress`;
        const detailRes = await fetch(detailUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-Cafe24-Api-Version': '2026-03-01',
          },
        });
        const detailJson = await detailRes.json().catch(() => null);
        const o = detailJson?.order;
        const shopNo = process.env.CAFE24_SHOP_NO ?? '1';
        const headers = { Authorization: `Bearer ${accessToken}`, 'X-Cafe24-Api-Version': '2026-03-01' };

        // receivers 엔드포인트 시도
        const recvRes = await fetch(`https://${mallId}.cafe24api.com/api/v2/admin/orders/${orderId}/receivers?shop_no=${shopNo}`, { headers });
        const recvJson = await recvRes.json().catch(() => null);

        detailTest = {
          status: detailRes.status,
          billing_name: o?.billing_name,
          items_sample: o?.items?.slice(0, 1)?.map((i: any) => ({ product_name: i.product_name, quantity: i.quantity })),
          receivers_status: recvRes.status,
          receivers: recvJson,
        };
      }

      // 주문 목록의 raw 필드명 확인 (회원 동기화 폴백 디버깅용)
      const firstRaw = json?.orders?.[0];
      const rawFields = firstRaw ? Object.keys(firstRaw) : [];
      const memberFields = firstRaw ? {
        member_id: firstRaw.member_id,
        buyer_name: firstRaw.buyer_name,
        buyer_cellphone: firstRaw.buyer_cellphone,
        buyer_email: firstRaw.buyer_email,
        billing_name: firstRaw.billing_name,
        buyer_phone: firstRaw.buyer_phone,
        order_id: firstRaw.order_id,
      } : null;

      apiTest = {
        status: res.status,
        order_count: json?.orders?.length ?? 0,
        first_order_id: orderId,
        raw_field_names: rawFields,
        member_related_fields: memberFields,
        detailTest,
      };
    } catch (e: any) {
      apiTest = { error: e.message };
    }
  }

  // orders 라우트 직접 호출 테스트
  const today = new Date().toISOString().split('T')[0];
  let ordersRouteTest: any = null;
  try {
    const host = process.env.CAFE24_REDIRECT_URI?.replace('/api/cafe24/callback', '') ?? 'https://e-scm-kyo.vercel.app';
    const r = await fetch(`${host}/api/cafe24/orders?start_date=${today}&end_date=${today}`);
    const j = await r.json();
    ordersRouteTest = { status: r.status, order_count: j.orders?.length, first: j.orders?.[0] };
  } catch (e: any) {
    ordersRouteTest = { error: e.message };
  }

  return NextResponse.json({
    scopeDiag,
    envCheck,
    tokenInDB: tokenDbRow ?? null,
    tokenDbError: tokenError?.message ?? null,
    hasValidToken: !!accessToken,
    apiTest,
    ordersRouteTest,
  });
}
