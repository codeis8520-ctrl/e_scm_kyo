import { createClient as createSupabaseClient } from '@supabase/supabase-js';

const MALL_ID = process.env.CAFE24_MALL_ID!;
const CLIENT_ID = process.env.CAFE24_CLIENT_ID!;
const CLIENT_SECRET = process.env.CAFE24_CLIENT_SECRET!;

// 쿠키 컨텍스트 없이 직접 anon 클라이언트 사용 (OAuth 콜백 등 세션 없는 환경)
function getSupabase() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

function tokenUrl() {
  return `https://${MALL_ID}.cafe24api.com/api/v2/oauth/token`;
}

function basicAuth() {
  return 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
}

export interface TokenRow {
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
  refresh_token_expires_at: string;
}

/** DB에서 토큰 로드 */
export async function loadTokens(): Promise<TokenRow | null> {
  const { data } = await getSupabase()
    .from('cafe24_tokens')
    .select('*')
    .eq('mall_id', MALL_ID)
    .maybeSingle();
  return data || null;
}

/** authorization_code → 토큰 교환 후 DB 저장 */
export async function exchangeCodeForTokens(code: string, redirectUri: string): Promise<TokenRow> {
  const res = await fetch(tokenUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': basicAuth(),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`토큰 교환 실패: ${res.status} ${err}`);
  }

  const data = await res.json();
  await upsertTokens(data);
  return data;
}

/** refresh_token으로 access_token 갱신 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenRow> {
  const res = await fetch(tokenUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': basicAuth(),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`토큰 갱신 실패: ${res.status} ${err}`);
  }

  const data = await res.json();
  await upsertTokens(data);
  return data;
}

async function upsertTokens(data: any) {
  // Cafe24 응답: expires_at (ISO 문자열) 또는 expires_in (초)
  let accessExpiresAt = data.expires_at;
  if (!accessExpiresAt && data.expires_in) {
    accessExpiresAt = new Date(Date.now() + Number(data.expires_in) * 1000).toISOString();
  }

  let refreshExpiresAt = data.refresh_token_expires_at;
  if (!refreshExpiresAt && data.refresh_token_expires_in) {
    refreshExpiresAt = new Date(Date.now() + Number(data.refresh_token_expires_in) * 1000).toISOString();
  }

  console.log('[cafe24 upsertTokens] access_expires_at:', accessExpiresAt,
    'refresh_expires_at:', refreshExpiresAt,
    'raw keys:', Object.keys(data).join(', '));

  const { error } = await getSupabase()
    .from('cafe24_tokens')
    .upsert(
      {
        mall_id: MALL_ID,
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        access_token_expires_at: accessExpiresAt,
        refresh_token_expires_at: refreshExpiresAt,
        scopes: data.scopes || [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'mall_id' }
    );

  if (error) {
    throw new Error(`토큰 DB 저장 실패: ${error.message}`);
  }
}

/** 유효한 access_token 반환 (만료 시 자동 갱신) */
export async function getValidAccessToken(): Promise<string | null> {
  const row = await loadTokens();
  if (!row) return null;

  const expiresAt = new Date(row.access_token_expires_at).getTime();
  const now = Date.now();

  // expires_at이 유효하지 않거나 만료 5분 전이면 갱신
  if (isNaN(expiresAt) || now >= expiresAt - 5 * 60 * 1000) {
    try {
      const refreshed = await refreshAccessToken(row.refresh_token);
      return refreshed.access_token;
    } catch (err) {
      console.error('[cafe24 getValidAccessToken] refresh failed:', err);
      return null;
    }
  }

  return row.access_token;
}
