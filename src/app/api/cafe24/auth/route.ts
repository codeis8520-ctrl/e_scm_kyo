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
    scope: 'mall.read_order,mall.read_customer,mall.read_privacy,mall.read_personal',
  });

  const authUrl = `https://${mallId}.cafe24api.com/api/v2/oauth/authorize?${params}`;
  return NextResponse.redirect(authUrl);
}
