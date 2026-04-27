import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getValidAccessToken, forceRefreshAccessToken } from '@/lib/cafe24/token-store';
import { kstTodayString, fmtDateKST } from '@/lib/date';

// Cafe24 주문 품목의 선택사항(option_value / additional_option_value / options[]) 추출.
// 일반 형식: "색상=레드&사이즈=L" 또는 [{option_name, option_value}] 배열.
function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}
function parseOptionPairs(raw: any): string {
  if (!raw) return '';
  if (Array.isArray(raw)) {
    return raw
      .map((o: any) => {
        const k = (o?.option_name ?? o?.name ?? '').toString().trim();
        const v = (o?.option_value ?? o?.value ?? '').toString().trim();
        return v ? (k ? `${k}: ${v}` : v) : '';
      })
      .filter(Boolean).join(', ');
  }
  if (typeof raw !== 'string') return '';
  return raw.split('&')
    .map(pair => {
      const eq = pair.indexOf('=');
      if (eq < 0) return safeDecode(pair).trim();
      const k = safeDecode(pair.slice(0, eq)).trim();
      const v = safeDecode(pair.slice(eq + 1)).trim();
      return v ? `${k}: ${v}` : k;
    })
    .filter(Boolean).join(', ');
}
function extractItemOptions(item: any): string {
  // 1순위: option_value (단일 옵션 그룹)
  // 2순위: options 배열 (Cafe24 응답에 따라 존재)
  // 3순위: additional_option_value (추가 옵션)
  const main = parseOptionPairs(item?.option_value)
            || parseOptionPairs(item?.options);
  const add = parseOptionPairs(item?.additional_option_value)
            || parseOptionPairs(item?.additional_options);
  return [main, add].filter(Boolean).join(' / ');
}

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

  // KST 기준 "오늘" / "7일 전" 캘린더 date (Cafe24 API는 calendar date 수용)
  const endDate = searchParams.get('end_date') ?? kstTodayString();
  const startDate =
    searchParams.get('start_date') ??
    fmtDateKST(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

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

  let accessToken = await getValidAccessToken();

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
  const makeHeaders = (token: string) => ({
    Authorization: `Bearer ${token}`,
    'X-Cafe24-Api-Version': '2026-03-01',
  });
  let headers = makeHeaders(accessToken);

  try {
    // 1. 주문 목록 — 401이면 강제 재발급 후 1회 재시도 (장시간 idle 후 진입 시 발생)
    const fetchList = () => fetch(
      `${base}/admin/orders?start_date=${startDate}&end_date=${endDate}&limit=100&shop_no=${shopNo}`,
      { headers }
    );
    let listRes = await fetchList();
    if (listRes.status === 401) {
      console.warn('[cafe24 orders] 401 — 토큰 강제 재발급 후 재시도');
      const refreshed = await forceRefreshAccessToken();
      if (refreshed) {
        accessToken = refreshed;
        headers = makeHeaders(accessToken);
        listRes = await fetchList();
      }
    }
    if (!listRes.ok) {
      const errBody = await listRes.text().catch(() => '');
      console.error(`Cafe24 Orders 목록 오류: ${listRes.status}`, errBody);
      const reason = listRes.status === 401
        ? '카페24 토큰 만료 — refresh도 실패했습니다. 토큰 갱신 버튼 또는 /api/cafe24/auth에서 재인증하세요.'
        : `카페24 API 오류 (${listRes.status}) — 토큰 갱신 버튼을 눌러주세요.`;
      return NextResponse.json({
        orders: [],
        is_demo: false,
        error: true,
        demo_reason: reason,
      });
    }

    const listJson = await listRes.json();
    const rawOrders: any[] = listJson.orders ?? [];

    // 2. 주문별 상세(items) + receivers 병렬 조회
    const orders: Cafe24OrderForShipping[] = await Promise.all(
      rawOrders.map(async (o: any) => {
        const orderId = String(o.order_id ?? '');

        const [detailRes, recvRes] = await Promise.all([
          fetch(`${base}/admin/orders/${orderId}?shop_no=${shopNo}&embed=items,buyer,receivers`, { headers }),
          fetch(`${base}/admin/orders/${orderId}/receivers?shop_no=${shopNo}`, { headers }),
        ]);

        const detail = detailRes.ok ? await detailRes.json() : null;
        const recvData = recvRes.ok ? await recvRes.json() : null;

        const detailOrder = detail?.order ?? null;
        const receiver = recvData?.receivers?.[0] ?? null;
        const items: any[] = detailOrder?.items ?? [];

        const itemsSummary = items.length > 0
          ? items.map((i: any) => {
              const name = i.product_name ?? '';
              const qty = i.quantity ?? 1;
              const opt = extractItemOptions(i);
              return opt ? `${name} [${opt}] x${qty}` : `${name} x${qty}`;
            }).join(', ')
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
          // 배송메모: 1순위=배송지(receivers).shipping_message,
          //          2순위=상세 주문의 동일 필드(폴백),
          //          3순위=주문 레벨 user_id_message(구버전 메모 필드)
          delivery_message:
            receiver?.shipping_message
            || detailOrder?.shipping_message
            || detailOrder?.user_id_message
            || o?.user_id_message
            || '',
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
