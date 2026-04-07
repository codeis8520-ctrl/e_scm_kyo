/**
 * Solapi SMS/알림톡 API 클라이언트
 *
 * 필요 환경 변수:
 *   SOLAPI_API_KEY      — Solapi 콘솔에서 발급
 *   SOLAPI_API_SECRET   — Solapi 콘솔에서 발급
 *   SOLAPI_SENDER_PHONE — 발신번호 (사전 등록 필요, 예: 01012345678)
 */

import { createHmac, randomBytes } from 'crypto';

const BASE_URL = 'https://api.solapi.com';

function makeAuthHeader(): string {
  const apiKey    = process.env.SOLAPI_API_KEY!;
  const apiSecret = process.env.SOLAPI_API_SECRET!;

  const date = new Date().toISOString();
  const salt = randomBytes(16).toString('hex');
  const signature = createHmac('sha256', apiSecret)
    .update(date + salt)
    .digest('hex');

  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

export interface SmsMessage {
  to: string;          // 수신번호 (하이픈 제거, 예: 01012345678)
  text: string;        // 메시지 내용
  customerId?: string; // 내부 고객 ID (로깅용)
  type?: 'SMS' | 'LMS'; // 90바이트 초과 시 LMS, 기본 SMS
}

export interface KakaoMessage {
  to: string;
  templateId: string;    // Solapi 카카오 알림톡 템플릿 ID (KA01TP...)
  variables: Record<string, string>;  // #{변수명}: 값 (치환 전 키)
  text: string;          // 변수 치환 완료된 최종 메시지 내용
  customerId?: string;
}

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface BulkSendResult {
  successCount: number;
  failCount: number;
  results: (SendResult & { to: string })[];
}

/**
 * SMS/LMS 단건 또는 다건 발송
 * Solapi /messages/v4/send-many 엔드포인트 사용
 */
export async function sendMessages(messages: SmsMessage[]): Promise<BulkSendResult> {
  if (!process.env.SOLAPI_API_KEY || !process.env.SOLAPI_API_SECRET) {
    return {
      successCount: 0,
      failCount: messages.length,
      results: messages.map(m => ({ to: m.to, success: false, error: 'SOLAPI 환경변수가 설정되지 않았습니다.' })),
    };
  }

  const sender = process.env.SOLAPI_SENDER_PHONE!;
  const body = {
    messages: messages.map(m => {
      const isLms = Buffer.byteLength(m.text, 'utf8') > 90;
      return {
        to: m.to.replace(/-/g, ''),
        from: sender,
        text: m.text,
        type: m.type ?? (isLms ? 'LMS' : 'SMS'),
      };
    }),
  };

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/messages/v4/send-many`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': makeAuthHeader(),
      },
      body: JSON.stringify(body),
    });
  } catch (err: any) {
    return {
      successCount: 0,
      failCount: messages.length,
      results: messages.map(m => ({ to: m.to, success: false, error: err.message })),
    };
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errMsg = data?.message || data?.errorMessage || `HTTP ${res.status}`;
    return {
      successCount: 0,
      failCount: messages.length,
      results: messages.map(m => ({ to: m.to, success: false, error: errMsg })),
    };
  }

  // Solapi 응답: { errorCount, resultList: [{ to, messageId, statusCode, statusMessage }] }
  const resultList: any[] = data.resultList || [];
  const results = messages.map((m, i) => {
    const r = resultList[i];
    const success = r?.statusCode === '2000';
    return {
      to: m.to,
      success,
      messageId: r?.messageId,
      error: success ? undefined : (r?.statusMessage || '알 수 없는 오류'),
    };
  });

  return {
    successCount: results.filter(r => r.success).length,
    failCount:    results.filter(r => !r.success).length,
    results,
  };
}

/**
 * 카카오 알림톡 단건 또는 다건 발송
 * Solapi에서 카카오 채널 연동 설정 필요
 */
export async function sendKakaoMessages(messages: KakaoMessage[]): Promise<BulkSendResult> {
  if (!process.env.SOLAPI_API_KEY || !process.env.SOLAPI_API_SECRET) {
    return {
      successCount: 0,
      failCount: messages.length,
      results: messages.map(m => ({ to: m.to, success: false, error: 'SOLAPI 환경변수가 설정되지 않았습니다.' })),
    };
  }

  const sender = process.env.SOLAPI_SENDER_PHONE!;
  const pfId   = process.env.SOLAPI_KAKAO_PFID;  // 플러스친구 채널 ID (선택)

  // Solapi AlimTalk API: 변수 키에서 #{ } 제거 (예: "#{홍길동}" → "홍길동")
  const stripBraces = (vars: Record<string, string>) =>
    Object.fromEntries(Object.entries(vars).map(([k, v]) => [k.replace(/^#\{/, '').replace(/\}$/, ''), v]));

  const body = {
    messages: messages.map(m => ({
      to: m.to.replace(/-/g, ''),
      from: sender,
      type: 'ATA',
      text: m.text,   // 치환 완료된 최종 내용 (필수)
      kakaoOptions: {
        ...(pfId ? { pfId } : {}),
        templateId: m.templateId,
        variables: stripBraces(m.variables),
        disableSms: false,
      },
    })),
  };

  console.log('[Solapi KakaoATA] request body:', JSON.stringify(body, null, 2));

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/messages/v4/send-many`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': makeAuthHeader(),
      },
      body: JSON.stringify(body),
    });
  } catch (err: any) {
    return {
      successCount: 0,
      failCount: messages.length,
      results: messages.map(m => ({ to: m.to, success: false, error: err.message })),
    };
  }

  const data = await res.json().catch(() => ({}));
  console.log('[Solapi KakaoATA] response:', JSON.stringify(data, null, 2));

  if (!res.ok) {
    const errMsg = data?.message || `HTTP ${res.status}`;
    return {
      successCount: 0,
      failCount: messages.length,
      results: messages.map(m => ({ to: m.to, success: false, error: errMsg })),
    };
  }

  const resultList: any[] = data.resultList || [];
  const results = messages.map((m, i) => {
    const r = resultList[i];
    const success = r?.statusCode === '2000';
    return {
      to: m.to,
      success,
      messageId: r?.messageId,
      error: success ? undefined : (r?.statusMessage || '알 수 없는 오류'),
    };
  });

  return {
    successCount: results.filter(r => r.success).length,
    failCount:    results.filter(r => !r.success).length,
    results,
  };
}

export interface SolapiKakaoTemplate {
  templateId: string;
  name: string;
  content: string;
  status: string;       // APPROVED, PENDING 등
  variables: string[];  // ["#{고객명}", "#{상품명}"] 등
  pfId: string;
}

/**
 * 솔라피에 등록된 카카오 알림톡 템플릿 목록 조회
 * 승인된(APPROVED) 템플릿만 반환
 */
export async function getKakaoTemplates(): Promise<SolapiKakaoTemplate[]> {
  if (!process.env.SOLAPI_API_KEY || !process.env.SOLAPI_API_SECRET) {
    return [];
  }

  const pfId = process.env.SOLAPI_KAKAO_PFID;
  const params = new URLSearchParams({ limit: '100', status: 'APPROVED' });
  if (pfId) params.set('pfId', pfId);

  try {
    const res = await fetch(`${BASE_URL}/kakao/v2/templates?${params}`, {
      headers: { Authorization: makeAuthHeader() },
      cache: 'no-store',
    });

    if (!res.ok) return [];

    const data = await res.json().catch(() => ({}));
    const list: any[] = data.templateList ?? data.data ?? [];

    return list.map((t: any) => ({
      templateId: t.templateId ?? t.id ?? '',
      name: t.name ?? t.templateName ?? '',
      content: t.content ?? t.templateContent ?? '',
      status: t.status ?? '',
      variables: Array.isArray(t.variables) ? t.variables : [],
      pfId: t.pfId ?? '',
    }));
  } catch {
    return [];
  }
}
