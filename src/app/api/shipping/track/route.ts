import { NextRequest, NextResponse } from 'next/server';

// 스마트택배 (SweetTracker) API — https://tracking.sweettracker.co.kr
// 가입: https://tracking.sweettracker.co.kr → 로그인 후 API 키 발급
// 환경변수: SWEETTRACKER_API_KEY
// CJ대한통운 t_code: 04

export async function GET(req: NextRequest) {
  const trackingNo = req.nextUrl.searchParams.get('trackingNo');
  if (!trackingNo) {
    return NextResponse.json({ error: 'trackingNo required' }, { status: 400 });
  }

  const apiKey = process.env.SWEETTRACKER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'API_KEY_NOT_SET' });
  }

  try {
    const url = `https://info.sweettracker.co.kr/api/v1/trackingInfo?t_key=${apiKey}&t_code=04&t_invoice=${trackingNo}`;
    const res = await fetch(url);

    if (res.status === 429) {
      return NextResponse.json({ error: 'quota_exceeded' }, { status: 429 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: `SweetTracker API ${res.status}` });
    }

    const data = await res.json();

    // 오류 응답 처리 (스마트택배는 200 + msg 필드로 오류 반환)
    if (data.status === false || data.msg) {
      return NextResponse.json({ error: data.msg || '조회 실패' });
    }

    // level 6 = 배송완료
    const status: 'SHIPPED' | 'DELIVERED' = data.level === 6 ? 'DELIVERED' : 'SHIPPED';
    const details: any[] = data.trackingDetails || [];
    const last = details[details.length - 1];

    return NextResponse.json({
      trackingNo,
      status,
      stateText: data.deliveryStatus || (status === 'DELIVERED' ? '배송완료' : '배송중'),
      lastLocation: last?.where || '',
      lastTime: last?.timeString || '',
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
