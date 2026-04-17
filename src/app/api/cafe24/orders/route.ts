import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getValidAccessToken } from '@/lib/cafe24/token-store';

interface Cafe24OrderForShipping {
  cafe24_order_id: string;
  order_date: string;
  orderer_name: string;
  orderer_phone: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_address: string;
  delivery_message: string;
  items_summary: string;
  total_price: number;
  already_added: boolean;
  cafe24_status: string;
}

const DEMO_ORDERS: Omit<Cafe24OrderForShipping, 'already_added'>[] = [
  {
    cafe24_order_id: 'CAFE24-2024-0001',
    order_date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    orderer_name: '김지현',
    orderer_phone: '010-3245-7891',
    recipient_name: '김지현',
    recipient_phone: '010-3245-7891',
    recipient_address: '서울특별시 강남구 테헤란로 152 강남파이낸스센터 3층',
    delivery_message: '부재 시 경비실에 맡겨주세요.',
    items_summary: '경옥고 80g x1, 공진단 10환 x2',
    total_price: 185000,
    cafe24_status: 'F',
  },
  {
    cafe24_order_id: 'CAFE24-2024-0002',
    order_date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    orderer_name: '박성훈',
    orderer_phone: '010-5678-1234',
    recipient_name: '박성훈',
    recipient_phone: '010-5678-1234',
    recipient_address: '경기도 성남시 분당구 판교역로 235 에이치스퀘어 N동 2층',
    delivery_message: '',
    items_summary: '경옥고 160g x1',
    total_price: 98000,
    cafe24_status: 'A',
  },
  {
    cafe24_order_id: 'CAFE24-2024-0003',
    order_date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    orderer_name: '이수연',
    orderer_phone: '010-9012-3456',
    recipient_name: '이수연',
    recipient_phone: '010-9012-3456',
    recipient_address: '서울특별시 서초구 반포대로 201 반포자이아파트 101동 1502호',
    delivery_message: '문 앞에 놓아주세요.',
    items_summary: '공진단 5환 x1, 경옥고 80g x2',
    total_price: 142000,
    cafe24_status: 'B',
  },
];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const endDate = searchParams.get('end_date') ?? new Date().toISOString().split('T')[0];
  const startDate =
    searchParams.get('start_date') ??
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // 기존에 등록된 cafe24_order_id 목록 조회
  const supabase = await createClient();
  const { data: existingShipments } = await supabase
    .from('shipments')
    .select('cafe24_order_id')
    .not('cafe24_order_id', 'is', null);

  const existingIds = new Set(
    (existingShipments ?? []).map((s: any) => s.cafe24_order_id).filter(Boolean)
  );

  const mallId = process.env.CAFE24_MALL_ID;

  if (!mallId) {
    const orders = DEMO_ORDERS.map(o => ({ ...o, already_added: existingIds.has(o.cafe24_order_id) }));
    return NextResponse.json({ orders, is_demo: true, demo_reason: 'CAFE24_MALL_ID 환경변수 없음' });
  }

  const accessToken = await getValidAccessToken();

  if (!accessToken) {
    // 토큰 만료 시 더미 대신 명확한 에러 반환
    return NextResponse.json({
      orders: [],
      is_demo: false,
      error: true,
      demo_reason: '카페24 토큰 만료 — 토큰 갱신 버튼을 누르거나 /api/cafe24/auth에서 재인증하세요.',
    });
  }

  const shopNo = process.env.CAFE24_SHOP_NO ?? '1';
  const base = `https://${mallId}.cafe24api.com/api/v2`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'X-Cafe24-Api-Version': '2026-03-01',
  };

  try {
    // 1. 주문 목록
    const listRes = await fetch(
      `${base}/admin/orders?start_date=${startDate}&end_date=${endDate}&limit=100&shop_no=${shopNo}`,
      { headers }
    );
    if (!listRes.ok) {
      const errBody = await listRes.text().catch(() => '');
      console.error(`Cafe24 Orders 목록 오류: ${listRes.status}`, errBody);
      return NextResponse.json({
        orders: [],
        is_demo: false,
        error: true,
        demo_reason: `카페24 API 오류 (${listRes.status}) — 토큰 갱신 버튼을 눌러주세요.`,
      });
    }

    const listJson = await listRes.json();
    const rawOrders: any[] = listJson.orders ?? [];

    // 2. 주문별 상세(items) + receivers 병렬 조회
    const orders: Cafe24OrderForShipping[] = await Promise.all(
      rawOrders.map(async (o: any) => {
        const orderId = String(o.order_id ?? '');

        const [detailRes, recvRes] = await Promise.all([
          fetch(`${base}/admin/orders/${orderId}?shop_no=${shopNo}&embed=items`, { headers }),
          fetch(`${base}/admin/orders/${orderId}/receivers?shop_no=${shopNo}`, { headers }),
        ]);

        const detail = detailRes.ok ? await detailRes.json() : null;
        const recvData = recvRes.ok ? await recvRes.json() : null;

        const detailOrder = detail?.order ?? null;
        const receiver = recvData?.receivers?.[0] ?? null;
        const items: any[] = detailOrder?.items ?? [];

        const itemsSummary = items.length > 0
          ? items.map((i: any) => `${i.product_name ?? ''} x${i.quantity ?? 1}`).join(', ')
          : '';

        const address = receiver?.address_full
          ?? [receiver?.address1, receiver?.address2].filter(Boolean).join(' ')
          ?? '';

        // order_status: 목록 API에 없을 경우 상세 API에서 가져옴
        // paid/canceled boolean으로 파생 (최후 수단)
        const rawStatus = o.order_status
          || detailOrder?.order_status
          || (o.canceled === 'T' ? 'C' : o.paid === 'T' ? 'F' : 'N');

        return {
          cafe24_order_id: orderId,
          order_date: (o.order_date ?? '').split('T')[0],
          orderer_name: o.billing_name ?? detailOrder?.billing_name ?? '',
          orderer_phone: receiver?.cellphone ?? receiver?.phone ?? '',
          recipient_name: receiver?.name ?? '',
          recipient_phone: receiver?.cellphone ?? receiver?.phone ?? '',
          recipient_address: address,
          delivery_message: receiver?.shipping_message ?? '',
          items_summary: itemsSummary,
          total_price: Number(o.payment_amount ?? detailOrder?.payment_amount ?? 0),
          already_added: existingIds.has(orderId),
          cafe24_status: rawStatus,
        };
      })
    );

    return NextResponse.json({ orders, is_demo: false });
  } catch (err: unknown) {
    console.error('Cafe24 Orders API 오류:', err);
    return NextResponse.json({
      orders: [],
      is_demo: false,
      error: true,
      demo_reason: `카페24 API 오류: ${err instanceof Error ? err.message : '알 수 없는 오류'}`,
    });
  }
}
