import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getValidAccessToken } from '@/lib/cafe24/token-store';

export async function GET() {
  const mallId = process.env.CAFE24_MALL_ID;
  const clientId = process.env.CAFE24_CLIENT_ID;

  // 1. 환경변수 확인
  const envCheck = {
    CAFE24_MALL_ID: !!mallId,
    CAFE24_CLIENT_ID: !!clientId,
    CAFE24_CLIENT_SECRET: !!process.env.CAFE24_CLIENT_SECRET,
    CAFE24_REDIRECT_URI: process.env.CAFE24_REDIRECT_URI || '(auto)',
  };

  // 2. DB 토큰 확인
  const supabase = await createClient();
  const { data: tokenRow, error: tokenError } = await (supabase as any)
    .from('cafe24_tokens')
    .select('mall_id, access_token_expires_at, refresh_token_expires_at, updated_at')
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
        detailTest = {
          status: detailRes.status,
          keys: o ? Object.keys(o) : [],
          billing_name: o?.billing_name,
          billing_phone: o?.billing_phone,
          billing_cellphone: o?.billing_cellphone,
          shippingaddress: o?.shippingaddress,
          receivers: o?.receivers,
          items: o?.items?.slice(0, 2),
        };
      }

      apiTest = {
        status: res.status,
        order_count: json?.orders?.length ?? 0,
        first_order_id: orderId,
        detailTest,
      };
    } catch (e: any) {
      apiTest = { error: e.message };
    }
  }

  return NextResponse.json({
    envCheck,
    tokenInDB: tokenRow ?? null,
    tokenDbError: tokenError?.message ?? null,
    hasValidToken: !!accessToken,
    apiTest,
  });
}
