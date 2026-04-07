import {
  Cafe24OAuthTokens,
  Cafe24Order,
  Cafe24APIResponse,
  Cafe24Member,
} from './types';

const CAFE24_API_VERSION = '2024-03-01';

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

  async getOrder(orderNo: number): Promise<Cafe24APIResponse<Cafe24Order>> {
    return this.request<Cafe24Order>(`/admin/orders/${orderNo}`);
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
