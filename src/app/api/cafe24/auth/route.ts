import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const mallId = process.env.CAFE24_MALL_ID;
  const clientId = process.env.CAFE24_CLIENT_ID;

  if (!mallId || !clientId) {
    return NextResponse.json({ error: 'Cafe24 환경변수 미설정' }, { status: 500 });
  }

  const redirectUri =
    process.env.CAFE24_REDIRECT_URI ||
    `${req.nextUrl.protocol}//${req.nextUrl.host}/api/cafe24/callback`;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    state: crypto.randomUUID(),
    redirect_uri: redirectUri,
    // #62 Phase2: mall.write_order = 송장 역연동(createShipment/updateOrderStatus) 위해 추가. 재인증 필요(운영).
    scope: 'mall.read_order,mall.write_order,mall.read_customer,mall.read_personal,mall.read_store',
  });

  const authUrl = `https://${mallId}.cafe24api.com/api/v2/oauth/authorize?${params}`;
  return NextResponse.redirect(authUrl);
}
