import {
  Cafe24OAuthTokens,
  Cafe24Order,
  Cafe24APIResponse,
  Cafe24Member,
} from './types';

const CAFE24_API_VERSION = '2026-03-01';

export class Cafe24Client {
  private mallId: string;
  private clientId: string;
  private clientSecret: string;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(mallId: string, clientId: string, clientSecret: string) {
    this.mallId = mallId;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  setTokens(tokens: Cafe24OAuthTokens) {
    this.accessToken = tokens.access_token;
    this.refreshToken = tokens.refresh_token;
    this.tokenExpiresAt = tokens.expires_at;
  }

  // getValidAccessToken() 결과만으로 인증 — write 호출(#62) 등 토큰만 필요한 경로용.
  setAccessToken(token: string) {
    this.accessToken = token;
  }

  getTokens(): Cafe24OAuthTokens | null {
    if (!this.accessToken || !this.refreshToken) {
      return null;
    }
    return {
      access_token: this.accessToken,
      refresh_token: this.refreshToken,
      expires_at: this.tokenExpiresAt,
      token_type: 'Bearer',
    };
  }

  isTokenExpired(): boolean {
    return Date.now() >= this.tokenExpiresAt - 60000;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<Cafe24APIResponse<T>> {
    if (!this.accessToken) {
      return {
        success: false,
        data: null as unknown as T,
        error: { code: 'NOT_AUTHENTICATED', message: 'No access token available' },
      };
    }

    const baseUrl = `https://${this.mallId}.cafe24api.com/api/v2`;
    const url = `${baseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
          'X-Cafe24-Api-Version': CAFE24_API_VERSION,
          ...options.headers,
        },
      });

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        return this.request<T>(endpoint, options);
      }

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          data: null as unknown as T,
          error: {
            code: data.error?.code || 'API_ERROR',
            message: data.error?.message || 'Unknown API error',
          },
        };
      }

      return { success: true, data: data.resource };
    } catch (error) {
      return {
        success: false,
        data: null as unknown as T,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Network error',
        },
      };
    }
  }

  async getOrder(orderNo: number | string): Promise<Cafe24APIResponse<Cafe24Order>> {
    if (!this.accessToken) {
      return { success: false, data: null as any, error: { code: 'NOT_AUTHENTICATED', message: 'No access token' } };
    }
    const shopNo = process.env.CAFE24_SHOP_NO ?? '1';
    // embed=buyer: 주문자(orderer) 이름·전화 확보 (고객 dedup·스냅샷용)
    // embed=receivers: 폴백용(자가구매 시 수령자=주문자)
    const url = `https://${this.mallId}.cafe24api.com/api/v2/admin/orders/${orderNo}?shop_no=${shopNo}&embed=items,buyer,receivers`;
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'X-Cafe24-Api-Version': CAFE24_API_VERSION,
        },
      });
      const json = await res.json();
      if (!res.ok) {
        return {
          success: false,
          data: null as any,
          error: { code: String(res.status), message: json?.error?.message || JSON.stringify(json) },
        };
      }
      // 카페24 단일 주문 응답은 { order: {...} } 구조
      return { success: true, data: (json.order ?? json.resource) as Cafe24Order };
    } catch (e: any) {
      return { success: false, data: null as any, error: { code: 'NETWORK_ERROR', message: e?.message || 'fetch failed' } };
    }
  }

  async getOrders(params?: {
    start_date?: string;
    end_date?: string;
    order_status?: string;
    limit?: number;
    offset?: number;
  }): Promise<Cafe24APIResponse<{ orders: Cafe24Order[]; total_count: number }>> {
    const searchParams = new URLSearchParams();
    if (params?.start_date) searchParams.set('start_date', params.start_date);
    if (params?.end_date) searchParams.set('end_date', params.end_date);
    if (params?.order_status) searchParams.set('order_status', params.order_status);
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    const endpoint = `/admin/orders${query ? `?${query}` : ''}`;
    return this.request<{ orders: Cafe24Order[]; total_count: number }>(endpoint);
  }

  async getOrderStatuses(orderNos: number[]): Promise<
    Cafe24APIResponse<{
      orders: Array<{ order_no: number; order_status: string; shipped_date: string | null }>;
    }>
  > {
    const orderNosStr = orderNos.join(',');
    return this.request<{ orders: Array<{ order_no: number; order_status: string; shipped_date: string | null }> }>(
      `/admin/orders/status?order_no=${orderNosStr}`
    );
  }

  async getMembers(params?: {
    start_date?: string;
    end_date?: string;
    limit?: number;
    offset?: number;
  }): Promise<Cafe24APIResponse<{ members: Cafe24Member[]; total_count: number }>> {
    const searchParams = new URLSearchParams();
    if (params?.start_date) searchParams.set('start_date', params.start_date);
    if (params?.end_date) searchParams.set('end_date', params.end_date);
    if (params?.limit) searchParams.set('limit', params.limit.toString());
    if (params?.offset) searchParams.set('offset', params.offset.toString());

    const query = searchParams.toString();
    const endpoint = `/admin/members${query ? `?${query}` : ''}`;
    return this.request<{ members: Cafe24Member[]; total_count: number }>(endpoint);
  }

  // ─── write_order 메서드 (#62 Phase2 송장 역연동) — mall.write_order scope 필요 ───────────────
  //   orderNo = raw cafe24 order_no(shipments.cafe24_order_id). C24-{mall}-{no}(분개 reference)와 무관.
  //   request() 범용(POST/PUT body) 활용. 인증 실패·권한거부는 success:false 반환(throw 안 함) → 호출부 best-effort.

  // 송장 등록 — POST /admin/orders/{orderNo}/shipments. shipment_status='shipping'(배송중)로 1차 등록.
  async createShipment(
    orderNo: string,
    payload: { shipping_company_code: string; tracking_no: string; shipment_status?: string }
  ): Promise<Cafe24APIResponse<any>> {
    const shopNo = Number(process.env.CAFE24_SHOP_NO ?? '1');
    // 카페24 v2 송장 등록 바디: shop_no + requests[] (주문 전체 발송 — order_item_code 미지정 시 주문단위).
    const body = {
      shop_no: shopNo,
      request: {
        tracking_no: payload.tracking_no,
        shipping_company_code: payload.shipping_company_code,
        status: payload.shipment_status ?? 'shipping',
      },
    };
    return this.request<any>(`/admin/orders/${orderNo}/shipments`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  // 주문 상태 전환 보강 — PUT /admin/orders/{orderNo}. createShipment 로 배송중 미전환 시 사용.
  async updateOrderStatus(orderNo: string, status: string): Promise<Cafe24APIResponse<any>> {
    const shopNo = Number(process.env.CAFE24_SHOP_NO ?? '1');
    const body = { shop_no: shopNo, request: { order_status: status } };
    return this.request<any>(`/admin/orders/${orderNo}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  // 택배사 코드 확인용(읽기) — GET /admin/carriers. 운영이 CJ대한통운 shipping_company_code 확인 → env 주입.
  async getCarriers(): Promise<Cafe24APIResponse<{ carriers: Array<{ carrier_id: number; carrier_name: string; default_carrier?: string }> }>> {
    return this.request<{ carriers: Array<{ carrier_id: number; carrier_name: string; default_carrier?: string }> }>(
      '/admin/carriers'
    );
  }

  static generateCode(orderNo: number, mallId: string): string {
    return `C24-${mallId}-${orderNo}`;
  }
}

let cafe24ClientInstance: Cafe24Client | null = null;

export function getCafe24Client(): Cafe24Client | null {
  if (!process.env.CAFE24_MALL_ID || !process.env.CAFE24_CLIENT_ID || !process.env.CAFE24_CLIENT_SECRET) {
    console.warn('Cafe24 environment variables not configured');
    return null;
  }

  if (!cafe24ClientInstance) {
    cafe24ClientInstance = new Cafe24Client(
      process.env.CAFE24_MALL_ID,
      process.env.CAFE24_CLIENT_ID,
      process.env.CAFE24_CLIENT_SECRET
    );
  }

  return cafe24ClientInstance;
}

export function generateCafe24OrderCode(mallId: string, orderNo: number): string {
  return `C24-${mallId}-${orderNo}`;
}
