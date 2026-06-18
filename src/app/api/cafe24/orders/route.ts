import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getValidAccessToken, forceRefreshAccessToken } from '@/lib/cafe24/token-store';
import { cafe24OrderTotal, normalizeOptionValue, extractItemOptions } from '@/lib/cafe24/types';
import { kstTodayString, fmtDateKST } from '@/lib/date';

// extractItemOptions(옵션 표시 텍스트 추출)는 src/lib/cafe24/types.ts로 이동(단일 출처).
// webhook.ts(sales_order_items.order_option)와 공유 — drift 방지.

interface Cafe24OrderForShipping {
  cafe24_order_id: string;
  member_id?: string;       // 확정(배송 추가) 시 고객 dedup용. 비회원이면 ''.
  order_date: string;
  orderer_name: string;
  orderer_phone: string;
  orderer_email: string;
  orderer_address: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_address: string;
  delivery_message: string;
  items_summary: string;
  order_items: {
    name: string;
    quantity: number;
    price: number;
    option: string;
    product_code: string;
    option_value: string;   // 정규화된 매핑 키
    mapped_name: string | null;
  }[];
  total_price: number;
  already_added: boolean;
  cafe24_status: string;
  // 우리 고객DB 매칭 (이름 AND 전화). 매칭되면 그 고객, 아니면 null(미등록)
  customer_match: { id: string; name: string } | null;
  // 조회 집합 내 중복발송 의심 (같은 받는분 이름+전화+품목 시그니처가 2건 이상)
  is_dup: boolean;
}

// 카페24 매장 발송지(출고지) — 모든 주문에 동일하게 적용
interface Cafe24DefaultSender {
  source: 'shippingorigins' | 'store' | null;
  name: string;
  phone: string;
  zipcode: string;
  address: string;        // 도로명 또는 지번 (address1)
  address_detail: string; // 상세 (address2)
  warning?: string;       // 가져오지 못한 경우 사유
}

async function fetchDefaultSender(base: string, headers: Record<string, string>): Promise<Cafe24DefaultSender> {
  // 1순위: /admin/shippingorigins?default=T (mall.read_store 필요)
  try {
    const res = await fetch(`${base}/admin/shippingorigins?limit=100`, { headers });
    if (res.ok) {
      const j = await res.json();
      const list: any[] = j?.shippingorigins ?? [];
      if (list.length > 0) {
        // default 'T' 우선, 없으면 첫 번째
        const so = list.find((x: any) => x.default === 'T') ?? list[0];
        return {
          source: 'shippingorigins',
          name: so.sender_name ?? so.shipping_origin_name ?? '',
          phone: so.mobile ?? so.phone ?? '',
          zipcode: so.zipcode ?? '',
          address: so.address1 ?? '',
          address_detail: so.address2 ?? '',
        };
      }
    } else if (res.status !== 401 && res.status !== 403) {
      console.warn('[cafe24 sender] shippingorigins 응답 비정상:', res.status);
    }
  } catch (e) {
    console.warn('[cafe24 sender] shippingorigins 페치 실패:', e);
  }

  // 2순위: /admin/store
  try {
    const res = await fetch(`${base}/admin/store`, { headers });
    if (res.ok) {
      const j = await res.json();
      const s = j?.store ?? j;
      if (s) {
        return {
          source: 'store',
          name: s.president_name ?? s.company_name ?? s.shop_name ?? '',
          phone: s.phone ?? s.customer_service_phone ?? '',
          zipcode: s.zipcode ?? '',
          address: s.address1 ?? '',
          address_detail: s.address2 ?? '',
        };
      }
    }
  } catch (e) {
    console.warn('[cafe24 sender] store 페치 실패:', e);
  }

  return {
    source: null,
    name: '', phone: '', zipcode: '', address: '', address_detail: '',
    warning: '발송지 정보를 가져오지 못했습니다. 카페24 OAuth 스코프에 mall.read_store 추가 후 /api/cafe24/auth 재인증이 필요합니다.',
  };
}

const DEMO_ORDERS: Omit<Cafe24OrderForShipping, 'already_added' | 'orderer_email' | 'orderer_address' | 'customer_match' | 'is_dup'>[] = [
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
    order_items: [
      { name: '경옥고 80g', quantity: 1, price: 65000, option: '', product_code: '', option_value: '', mapped_name: null },
      { name: '공진단 10환', quantity: 2, price: 60000, option: '', product_code: '', option_value: '', mapped_name: null },
    ],
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
    order_items: [
      { name: '경옥고 160g', quantity: 1, price: 98000, option: '', product_code: '', option_value: '', mapped_name: null },
    ],
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
    order_items: [
      { name: '공진단 5환', quantity: 1, price: 12000, option: '', product_code: '', option_value: '', mapped_name: null },
      { name: '경옥고 80g', quantity: 2, price: 65000, option: '', product_code: '', option_value: '', mapped_name: null },
    ],
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
    const orders = DEMO_ORDERS.map(o => ({
      ...o,
      already_added: existingIds.has(o.cafe24_order_id),
      orderer_email: '',
      orderer_address: o.recipient_address,
      customer_match: null as { id: string; name: string } | null,
      is_dup: false,
    }));
    const default_sender: Cafe24DefaultSender = {
      source: null,
      name: '데모 발송자', phone: '02-0000-0000',
      zipcode: '06000', address: '서울특별시 강남구 데모로 1',
      address_detail: '데모빌딩 1층',
      warning: '데모 데이터입니다 — 실제 매장 발송지가 아님.',
    };
    return NextResponse.json({ orders, default_sender, is_demo: true, demo_reason: 'CAFE24_MALL_ID 환경변수 없음' });
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

    // 2. 주문별 상세(items) + receivers 병렬 조회 (1차: 페치만)
    const fetched = await Promise.all(
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
        const buyer = detailOrder?.buyer ?? {};
        const items: any[] = detailOrder?.items ?? [];

        return { o, orderId, detailOrder, receiver, buyer, items };
      })
    );

    // 3. 카페24 품목 → 내부 product 매핑 일괄 조회 (N+1 금지, 테이블 미적용 시 빈 Map 폴백).
    //    매핑 키 = (product_code, normalizeOptionValue(option_value)). 정규화는 단일 출처(types.ts).
    const mapKey = (code: string, optValue: string) => `${code}
${optValue}`;
    const productMap = new Map<string, string>();   // mapKey → product_id
    const productNameById = new Map<string, string>(); // product_id → name
    try {
      const wanted = new Set<string>();
      for (const f of fetched) {
        for (const i of f.items) {
          const code = String(i?.product_code ?? '');
          const optValue = normalizeOptionValue(i?.option_value);
          wanted.add(mapKey(code, optValue));
        }
      }
      if (wanted.size > 0) {
        const db = supabase as any;
        const { data: maps, error: mapErr } = await db
          .from('cafe24_product_map')
          .select('cafe24_product_code, option_value, product_id');
        if (!mapErr && Array.isArray(maps)) {
          for (const m of maps as any[]) {
            productMap.set(mapKey(String(m.cafe24_product_code ?? ''), String(m.option_value ?? '')), m.product_id);
          }
          const neededIds = [...new Set(
            [...wanted].map(k => productMap.get(k)).filter((v): v is string => !!v)
          )];
          if (neededIds.length > 0) {
            const { data: prods, error: prodErr } = await db
              .from('products')
              .select('id, name')
              .in('id', neededIds);
            if (!prodErr && Array.isArray(prods)) {
              for (const p of prods as any[]) productNameById.set(p.id, p.name);
            }
          }
        }
      }
    } catch {
      // 테이블 미적용/조회 실패 → 빈 Map 폴백(크래시 금지). 미매핑 품목은 현행 fallback 표시.
    }

    // item별 매핑 해소: 매핑된 내부 product.name 또는 null.
    const resolveMappedName = (i: any): string | null => {
      const code = String(i?.product_code ?? '');
      const optValue = normalizeOptionValue(i?.option_value);
      const pid = productMap.get(mapKey(code, optValue));
      return pid ? (productNameById.get(pid) ?? null) : null;
    };

    // 4. 주문 객체 빌드 (매핑 적용)
    const orders: Cafe24OrderForShipping[] = fetched.map(({ o, orderId, detailOrder, receiver, buyer, items }) => {
        const itemsSummary = items.length > 0
          ? items.map((i: any) => {
              const name = i.product_name ?? '';
              const qty = i.quantity ?? 1;
              const mapped = resolveMappedName(i);
              if (mapped) return `${mapped} x${qty}`;
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

        const buyerAddr = [buyer?.address1, buyer?.address2].filter(Boolean).join(' ');
        return {
          cafe24_order_id: orderId,
          member_id: (o.member_id ?? detailOrder?.member_id ?? '').toString().trim(),
          order_date: (o.order_date ?? '').split('T')[0],
          // 주문자(orderer): buyer 임베드 우선, 폴백 billing_name/수령자
          orderer_name: buyer?.name ?? o.billing_name ?? detailOrder?.billing_name ?? '',
          orderer_phone: buyer?.cellphone ?? buyer?.phone ?? receiver?.cellphone ?? receiver?.phone ?? '',
          orderer_email: buyer?.email ?? detailOrder?.member_email ?? '',
          orderer_address: buyerAddr || address,
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
          order_items: items.map((i: any) => ({
            name: i.product_name ?? '',
            quantity: i.quantity ?? 1,
            price: Number(i.product_price ?? i.payment_amount ?? 0) || 0,
            option: extractItemOptions(i),
            product_code: String(i?.product_code ?? ''),
            option_value: normalizeOptionValue(i?.option_value), // 정규화 매핑 키
            mapped_name: resolveMappedName(i),
          })),
          total_price: cafe24OrderTotal(detailOrder ?? o),
          already_added: existingIds.has(orderId),
          cafe24_status: rawStatus,
          customer_match: null as { id: string; name: string } | null,
          is_dup: false,
        };
      });

    // 고객 매칭 판정
    //  1) 확정(배송추가/전표생성)된 주문 → 실제 sales_orders.customer_id 연결 상태로 판정.
    //     연결돼 있으면 ✓고객, 아니면 미등록(이름·전화가 기존 고객과 같아도 미연결이면 등록 대상).
    //     → 등록 후 customer_id 가 채워지면 즉시 ✓고객으로 전환(요청: 미등록→고객 상태 변경).
    //  2) 미확정 주문 → 이름 AND 전화 휴리스틱(기존 동작).
    const digitsOf = (s: string) => (s || '').replace(/\D/g, '');
    const toDashed = (s: string) => {
      const d = digitsOf(s);
      if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
      if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
      return '';
    };

    // 확정 주문의 sales_order 연결 상태 일괄 조회
    const orderIds = [...new Set(orders.map(o => o.cafe24_order_id).filter(Boolean))];
    const soByOrderId = new Map<string, { customer_id: string | null }>();
    if (orderIds.length > 0) {
      const { data: sos } = await supabase
        .from('sales_orders')
        .select('cafe24_order_id, customer_id')
        .in('cafe24_order_id', orderIds);
      for (const s of (sos ?? []) as any[]) {
        // 동일 cafe24_order_id 다건이면 연결된(customer_id 있는) 행 우선
        const prev = soByOrderId.get(String(s.cafe24_order_id));
        if (!prev || (!prev.customer_id && s.customer_id)) {
          soByOrderId.set(String(s.cafe24_order_id), { customer_id: s.customer_id ?? null });
        }
      }
    }
    // 연결된 고객 이름 조회
    const linkedCustIds = [...new Set([...soByOrderId.values()].map(s => s.customer_id).filter((v): v is string => !!v))];
    const custNameById = new Map<string, string>();
    if (linkedCustIds.length > 0) {
      const { data: cs } = await supabase.from('customers').select('id, name').in('id', linkedCustIds);
      for (const c of (cs ?? []) as any[]) custNameById.set(c.id, c.name);
    }

    // 미확정 주문용 이름+전화 휴리스틱 맵
    const dashedPhones = [...new Set(orders.map(o => toDashed(o.orderer_phone)).filter(Boolean))];
    const byKey = new Map<string, { id: string; name: string }>();
    if (dashedPhones.length > 0) {
      const { data: custs } = await supabase
        .from('customers').select('id, name, phone').in('phone', dashedPhones);
      for (const c of (custs ?? []) as any[]) {
        byKey.set(`${digitsOf(c.phone)}|${c.name}`, { id: c.id, name: c.name });
      }
    }

    for (const o of orders) {
      const so = soByOrderId.get(o.cafe24_order_id);
      if (so) {
        // 확정 주문 — 실제 연결 상태로 판정
        o.customer_match = so.customer_id
          ? { id: so.customer_id, name: custNameById.get(so.customer_id) ?? o.orderer_name }
          : null;
      } else {
        // 미확정 주문 — 휴리스틱
        o.customer_match = byKey.get(`${digitsOf(o.orderer_phone)}|${o.orderer_name}`) ?? null;
      }
    }

    // 주문 중복 여부 — 같은 받는분(이름+전화)이 같은 품목 시그니처를 조회 집합 내 2건 이상 주문.
    //  키 = normName(recipient_name) | digitsOf(recipient_phone) | itemSig
    //  itemSig = order_items 를 (normName(name) x quantity) 로 매핑 → 정렬 → join('|') (표시문자열 미사용)
    //  받는분 이름/전화 결손 또는 품목 0건이면 후보 제외(오탐 방지).
    const normName = (s: string) => (s || '').replace(/\s+/g, '');
    const dupKeyOf = (o: Cafe24OrderForShipping): string | null => {
      const name = normName(o.recipient_name);
      const phone = digitsOf(o.recipient_phone);
      if (!name || !phone || o.order_items.length === 0) return null;
      const itemSig = o.order_items
        .map(i => `${normName(i.name)}x${i.quantity}`)
        .sort()
        .join('|');
      return `${name}|${phone}|${itemSig}`;
    };
    const dupCounts = new Map<string, number>();
    for (const o of orders) {
      const key = dupKeyOf(o);
      if (key) dupCounts.set(key, (dupCounts.get(key) ?? 0) + 1);
    }
    for (const o of orders) {
      const key = dupKeyOf(o);
      o.is_dup = key ? (dupCounts.get(key) ?? 0) >= 2 : false;
    }

    // 매장 발송지(출고지)는 이제 우리 시스템(branches.sender_*)에서 관리하므로
    // Cafe24 측에서 가져올 필요 없음. 응답에는 null 유지(클라이언트 호환).
    return NextResponse.json({ orders, default_sender: null, is_demo: false });
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
