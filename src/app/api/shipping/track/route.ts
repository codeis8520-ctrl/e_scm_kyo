import { NextRequest, NextResponse } from 'next/server';

// DeliveryTracker v2 API — https://tracker.delivery
// 가입: https://console.tracker.delivery (Google/email 가입 → Create Project → Credentials)
// 환경변수: DELIVERY_TRACKER_CLIENT_ID, DELIVERY_TRACKER_CLIENT_SECRET
// Authorization: TRACKQL-API-KEY {clientId}:{clientSecret}

export async function GET(req: NextRequest) {
  const trackingNo = req.nextUrl.searchParams.get('trackingNo');
  if (!trackingNo) {
    return NextResponse.json({ error: 'trackingNo required' }, { status: 400 });
  }

  const clientId = process.env.DELIVERY_TRACKER_CLIENT_ID;
  const clientSecret = process.env.DELIVERY_TRACKER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'API_KEY_NOT_SET' });
  }

  try {
    const res = await fetch(
      `https://apis.tracker.delivery/carriers/kr.cjlogistics/tracks/${trackingNo}`,
      { headers: { Authorization: `TRACKQL-API-KEY ${clientId}:${clientSecret}` } }
    );

    if (res.status === 429) {
      return NextResponse.json({ error: 'quota_exceeded' }, { status: 429 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: `Tracker API ${res.status}` });
    }

    const data = await res.json();
    const stateId: string = data.state?.id || '';
    const status: 'SHIPPED' | 'DELIVERED' = stateId === 'delivered' ? 'DELIVERED' : 'SHIPPED';
    const last = data.progresses?.[data.progresses.length - 1];

    return NextResponse.json({
      trackingNo,
      status,
      stateText: data.state?.text || stateId,
      lastLocation: last?.location?.name || '',
      lastTime: last?.time || '',
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
