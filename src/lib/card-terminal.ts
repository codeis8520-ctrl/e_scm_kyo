'use client';

// ── VAN 에이전트 통신 레이어 ───────────────────────────────────────────────────
// 에이전트 수령 후 .env.local 에 설정:
//   NEXT_PUBLIC_CARD_TERMINAL_URL=http://localhost:7001   ← 에이전트가 열어주는 포트
//   NEXT_PUBLIC_CARD_TERMINAL_TIMEOUT=60000              ← 타임아웃 ms (기본 60초)
//
// VAN사마다 요청/응답 필드명이 다를 수 있음.
// 아래 parseApprovalResponse() 에서 후보 필드명을 추가하면 됨.

export interface CardApprovalResult {
  success: boolean;
  approvalNo?: string;      // 승인번호
  cardName?: string;        // 카드사명
  cardLast4?: string;       // 카드번호 끝 4자리
  installment?: string;     // 할부개월 ('00' = 일시불)
  approvedAt?: string;      // 승인일시
  errorMessage?: string;
}

export interface CardCancelResult {
  success: boolean;
  errorMessage?: string;
}

function getBaseUrl(): string {
  return (typeof window !== 'undefined' && (window as any).__CARD_TERMINAL_URL__)
    || process.env.NEXT_PUBLIC_CARD_TERMINAL_URL
    || '/api/card-terminal/mock';   // env 미설정 시 내부 mock 사용 (테스트용)
}

export function isUsingMock(): boolean {
  return !process.env.NEXT_PUBLIC_CARD_TERMINAL_URL;
}

function getTimeout(): number {
  return parseInt(process.env.NEXT_PUBLIC_CARD_TERMINAL_TIMEOUT || '60000');
}

/** 응답 JSON에서 필드명 후보를 순서대로 시도해 첫 번째 값을 반환 */
function pick(obj: any, ...keys: string[]): string | undefined {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return String(obj[k]);
  }
  return undefined;
}

/** 승인 성공 여부 판단 (VAN사마다 성공 코드가 다름) */
function isApproved(obj: any): boolean {
  const code = pick(obj, 'resultCode', 'ResultCode', 'code', 'Code', 'resCd', 'result');
  if (!code) return false;
  return ['0000', '00', '000', 'SUCCESS', 'APPROVED', 'OK'].includes(code.toUpperCase());
}

/** 카드 번호에서 끝 4자리 추출 */
function extractLast4(cardNo?: string): string | undefined {
  if (!cardNo) return undefined;
  const digits = cardNo.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}

// ── 카드 승인 요청 ─────────────────────────────────────────────────────────────
export async function requestCardApproval(
  amount: number,
  taxAmount: number,
): Promise<CardApprovalResult> {
  const base = getBaseUrl();
  const url = base.startsWith('/') ? base : `${base}/card/approve`;
  const supplyAmount = amount - taxAmount;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getTimeout());

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // 공통 필드 (VAN사마다 사용하는 것이 다름 — 필요시 조정)
        reqType: 'APPROVAL',
        tradeType: '01',        // 01=승인
        amount,
        taxAmount,
        supplyAmount,
        serviceAmount: 0,       // 봉사료
        installment: '00',      // 00=일시불
      }),
      signal: controller.signal,
    });

    const data = await res.json();

    if (!isApproved(data)) {
      const msg = pick(data, 'resultMsg', 'ResultMsg', 'message', 'Message', 'errMsg', 'errorMessage')
        || '단말기 승인 거절';
      return { success: false, errorMessage: msg };
    }

    const cardNo = pick(data, 'cardNo', 'CardNo', 'card_no', 'maskedCardNo');
    return {
      success: true,
      approvalNo: pick(data, 'approvalNo', 'ApprovalNo', 'approval_no', 'authNo', 'AuthNo'),
      cardName: pick(data, 'cardName', 'CardName', 'card_name', 'issuerName'),
      cardLast4: extractLast4(cardNo),
      installment: pick(data, 'installment', 'Installment', 'quota') || '00',
      approvedAt: pick(data, 'approvalDate', 'ApprovalDate', 'tradeDate', 'resDate'),
    };

  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      return { success: false, errorMessage: '단말기 응답 시간 초과 (카드를 다시 시도해주세요)' };
    }
    if (err.message?.includes('fetch') || err.message?.includes('Failed')) {
      return {
        success: false,
        errorMessage: '단말기 미들웨어에 연결할 수 없습니다. 프로그램이 실행 중인지 확인하세요.',
      };
    }
    return { success: false, errorMessage: err.message || '단말기 오류' };
  } finally {
    clearTimeout(timer);
  }
}

// ── 카드 취소 요청 ─────────────────────────────────────────────────────────────
export async function requestCardCancel(
  approvalNo: string,
  amount: number,
  taxAmount: number,
): Promise<CardCancelResult> {
  const base = getBaseUrl();
  const url = base.startsWith('/') ? base : `${base}/card/cancel`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reqType: 'CANCEL',
        tradeType: '51',        // 51=취소 (VAN사마다 다를 수 있음)
        approvalNo,
        amount,
        taxAmount,
        supplyAmount: amount - taxAmount,
      }),
      signal: controller.signal,
    });

    const data = await res.json();
    if (!isApproved(data)) {
      const msg = pick(data, 'resultMsg', 'ResultMsg', 'message', 'errMsg') || '취소 실패';
      return { success: false, errorMessage: msg };
    }
    return { success: true };

  } catch (err: any) {
    clearTimeout(timer);
    return { success: false, errorMessage: err.message || '취소 오류' };
  } finally {
    clearTimeout(timer);
  }
}
