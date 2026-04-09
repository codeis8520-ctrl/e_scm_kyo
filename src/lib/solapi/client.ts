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

// ─── 잔액 조회 ──────────────────────────────────────────────────────────────

export async function getSolapiBalance(): Promise<{ balance?: number; point?: number; error?: string }> {
  if (!process.env.SOLAPI_API_KEY || !process.env.SOLAPI_API_SECRET) {
    return { error: 'SOLAPI 환경변수 미설정' };
  }
  try {
    const res = await fetch(`${BASE_URL}/cash/v1/balance`, {
      headers: { Authorization: makeAuthHeader() },
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { error: data?.errorMessage || data?.message || `HTTP ${res.status}` };
    }
    // 응답: { balance: number, point: number, ... } 또는 유사 구조
    return {
      balance: Number(data.balance ?? data.cash ?? data.amount ?? 0),
      point: Number(data.point ?? data.freeBalance ?? 0),
    };
  } catch (e: any) {
    return { error: e?.message || '잔액 조회 실패' };
  }
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
  console.log('[Solapi SMS] status:', res.status, 'response:', JSON.stringify(data, null, 2));

  if (!res.ok) {
    const errMsg = data?.errorMessage || data?.message || data?.error || `HTTP ${res.status}`;
    const errCode = data?.errorCode || data?.code || '';
    const fullErr = errCode ? `[${errCode}] ${errMsg}` : errMsg;
    return {
      successCount: 0,
      failCount: messages.length,
      results: messages.map(m => ({ to: m.to, success: false, error: fullErr })),
    };
  }

  // Solapi v4 /send-many 응답: { groupInfo, messageList, failedMessageList }
  const groupInfo = data.groupInfo || {};
  const groupId = groupInfo.groupId || data.groupId;
  const countInfo = groupInfo.count || data.count || {};
  const messageListRaw = data.messageList;
  const failedList: any[] = data.failedMessageList || [];

  let msgList: any[] = [];
  if (Array.isArray(messageListRaw)) {
    msgList = messageListRaw;
  } else if (messageListRaw && typeof messageListRaw === 'object') {
    msgList = Object.entries(messageListRaw).map(([id, v]: [string, any]) => ({ messageId: id, ...v }));
  }

  const normPhone = (p: string) => String(p || '').replace(/-/g, '');

  const results = messages.map(m => {
    const toNorm = normPhone(m.to);

    const failed = failedList.find((f: any) => normPhone(f.to) === toNorm);
    if (failed) {
      return { to: m.to, success: false, messageId: failed.messageId, error: failed.statusMessage || failed.reason || '발송 실패' };
    }

    const hit = msgList.find((r: any) => normPhone(r.to) === toNorm);
    if (hit) {
      const code = String(hit.statusCode || '');
      const isFailExplicit = code && !code.startsWith('2') && !code.startsWith('1');
      if (isFailExplicit) {
        return { to: m.to, success: false, messageId: hit.messageId, error: hit.statusMessage || `상태: ${code}` };
      }
      return { to: m.to, success: true, messageId: hit.messageId || groupId };
    }

    // 매칭 안 되면 전체 성공 여부로 판단
    const totalFailed = Number(countInfo.sentFailed || 0);
    if (totalFailed === 0) {
      return { to: m.to, success: true, messageId: groupId };
    }

    return { to: m.to, success: true, messageId: groupId };
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

  // Solapi AlimTalk API: 변수 키는 반드시 "#{변수명}" 형태로 전달
  // (이전엔 stripBraces로 중괄호를 제거했으나 "템플릿 내용과 변수가 일치하지 않습니다"
  //  오류가 발생해 원복. Solapi 공식 스펙은 #{} 포함 형태.)
  const ensureBraces = (vars: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(vars).map(([k, v]) => {
        const keyWithBraces = k.startsWith('#{') ? k : `#{${k.replace(/^#?\{?/, '').replace(/\}?$/, '')}}`;
        return [keyWithBraces, v];
      })
    );

  const body = {
    messages: messages.map(m => ({
      to: m.to.replace(/-/g, ''),
      from: sender,
      type: 'ATA',
      text: m.text,   // 치환 완료된 최종 내용 (필수)
      kakaoOptions: {
        ...(pfId ? { pfId } : {}),
        templateId: m.templateId,
        variables: ensureBraces(m.variables),
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
  console.log('[Solapi KakaoATA] status:', res.status, 'response:', JSON.stringify(data, null, 2));

  if (!res.ok) {
    // Solapi 에러 응답 본문에서 상세 메시지 추출
    const errMsg =
      data?.errorMessage ||
      data?.message ||
      data?.error ||
      `HTTP ${res.status}`;
    const errCode = data?.errorCode || data?.code || '';
    const fullErr = errCode ? `[${errCode}] ${errMsg}` : errMsg;
    return {
      successCount: 0,
      failCount: messages.length,
      results: messages.map(m => ({ to: m.to, success: false, error: fullErr })),
    };
  }

  // Solapi v4 /send-many 응답 구조:
  // {
  //   groupInfo: { groupId, count: { total, sentFailed, sentSuccess, ... } },
  //   messageList: { [messageId]: { statusCode, statusMessage, to, type } } | [...],
  //   failedMessageList: [...]   // 실패 건만 별도
  // }
  const groupInfo = data.groupInfo || {};
  const groupId = groupInfo.groupId || data.groupId;
  const countInfo = groupInfo.count || data.count || {};
  const messageListRaw = data.messageList;
  const failedList: any[] = data.failedMessageList || [];

  // messageList를 배열로 정규화
  let msgList: any[] = [];
  if (Array.isArray(messageListRaw)) {
    msgList = messageListRaw;
  } else if (messageListRaw && typeof messageListRaw === 'object') {
    msgList = Object.entries(messageListRaw).map(([id, v]: [string, any]) => ({ messageId: id, ...v }));
  }

  // to(수신자 번호)로 매칭 — 전화번호 정규화
  const normPhone = (p: string) => String(p || '').replace(/-/g, '');

  const results = messages.map(m => {
    const toNorm = normPhone(m.to);

    // 실패 목록에서 먼저 확인
    const failed = failedList.find((f: any) => normPhone(f.to) === toNorm);
    if (failed) {
      return {
        to: m.to,
        success: false,
        messageId: failed.messageId,
        error: failed.statusMessage || failed.reason || `실패 (${failed.statusCode || 'N/A'})`,
      };
    }

    // 성공 목록에서 매칭
    const hit = msgList.find((r: any) => normPhone(r.to) === toNorm);
    if (hit) {
      // statusCode '2000' 계열 또는 상태가 명시적으로 실패가 아니면 성공
      const code: string = String(hit.statusCode || '');
      const isFailExplicit = code && !code.startsWith('2') && !code.startsWith('1');
      if (isFailExplicit) {
        return {
          to: m.to,
          success: false,
          messageId: hit.messageId,
          error: hit.statusMessage || hit.reason || `상태 코드: ${code}`,
        };
      }
      return {
        to: m.to,
        success: true,
        messageId: hit.messageId || groupId,
      };
    }

    // 매칭되는 결과가 없으면 groupInfo.count로 전체 성공 여부 판단
    const totalFailed = Number(countInfo.sentFailed || 0);
    if (totalFailed === 0) {
      // 전체가 성공으로 접수됨 → 이 건도 성공으로 간주
      return { to: m.to, success: true, messageId: groupId };
    }

    // 결과를 특정할 수 없을 때 pending 취급 (실패 아님)
    return {
      to: m.to,
      success: true,
      messageId: groupId,
      error: undefined,
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
