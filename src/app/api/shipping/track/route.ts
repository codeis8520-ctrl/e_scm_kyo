import { NextRequest, NextResponse } from 'next/server';

// DeliveryTracker v2 API — https://tracker.delivery
// 환경변수: DELIVERY_TRACKER_API_KEY (미설정 시 API_KEY_NOT_SET 반환)

export async function GET(req: NextRequest) {
  const trackingNo = req.nextUrl.searchParams.get('trackingNo');
  if (!trackingNo) {
    return NextResponse.json({ error: 'trackingNo required' }, { status: 400 });
  }

  const apiKey = process.env.DELIVERY_TRACKER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'API_KEY_NOT_SET' });
  }

  try {
    const res = await fetch(
      `https://apis.tracker.delivery/carriers/kr.cjlogistics/tracks/${trackingNo}`,
      { headers: { Authorization: `KakaoAK ${apiKey}` } }
    );

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
