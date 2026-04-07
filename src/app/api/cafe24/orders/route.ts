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
    // 환경변수 없음 → 데모 데이터 반환
    const orders: Cafe24OrderForShipping[] = DEMO_ORDERS.map((order) => ({
      ...order,
      already_added: existingIds.has(order.cafe24_order_id),
    }));
    return NextResponse.json({ orders });
  }

  // 실 API 시도: 유효한 access_token이 있으면 Cafe24 API 호출
  const accessToken = await getValidAccessToken();

  if (!accessToken) {
    // 토큰 없음 → 데모 데이터 폴백
    const orders: Cafe24OrderForShipping[] = DEMO_ORDERS.map((order) => ({
      ...order,
      already_added: existingIds.has(order.cafe24_order_id),
    }));
    return NextResponse.json({ orders });
  }

  const shopNo = process.env.CAFE24_SHOP_NO ?? '1';
  const apiUrl = `https://${mallId}.cafe24api.com/api/v2/admin/orders?start_date=${startDate}&end_date=${endDate}&limit=100&shop_no=${shopNo}`;

  try {
    const apiRes = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Cafe24-Api-Version': '2024-03-01',
        'Content-Type': 'application/json',
      },
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error(`Cafe24 Orders API 오류: ${apiRes.status} ${errText}`);
      // API 오류 시 데모 데이터 폴백
      const orders: Cafe24OrderForShipping[] = DEMO_ORDERS.map((order) => ({
        ...order,
        already_added: existingIds.has(order.cafe24_order_id),
      }));
      return NextResponse.json({ orders });
    }

    const json = await apiRes.json();
    const rawOrders: any[] = json.orders ?? [];

    const orders: Cafe24OrderForShipping[] = rawOrders.map((o: any) => {
      const address = [o.receiver_address, o.receiver_address_detail]
        .filter(Boolean)
        .join(' ');

      const itemsSummary = Array.isArray(o.items)
        ? o.items.map((item: any) => `${item.product_name ?? ''} x${item.quantity ?? 1}`).join(', ')
        : '';

      return {
        cafe24_order_id: String(o.order_id ?? ''),
        order_date: (o.order_date ?? '').split('T')[0],
        orderer_name: o.buyer_name ?? '',
        orderer_phone: o.buyer_cellphone ?? o.buyer_phone ?? '',
        recipient_name: o.receiver_name ?? '',
        recipient_phone: o.receiver_cellphone ?? o.receiver_phone ?? '',
        recipient_address: address,
        delivery_message: o.delivery_message ?? '',
        items_summary: itemsSummary,
        total_price: Number(o.actual_price ?? o.order_price ?? 0),
        already_added: existingIds.has(String(o.order_id ?? '')),
      };
    });

    return NextResponse.json({ orders });
  } catch (err: unknown) {
    console.error('Cafe24 Orders API 네트워크 오류:', err);
    // 네트워크 오류 시 데모 데이터 폴백
    const orders: Cafe24OrderForShipping[] = DEMO_ORDERS.map((order) => ({
      ...order,
      already_added: existingIds.has(order.cafe24_order_id),
    }));
    return NextResponse.json({ orders });
  }
}
