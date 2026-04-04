import { NextRequest, NextResponse } from 'next/server';

// ── 모의 VAN 에이전트 ──────────────────────────────────────────────────────────
// NEXT_PUBLIC_CARD_TERMINAL_URL 미설정 시 card-terminal.ts 가 이 엔드포인트를 사용.
// 실제 단말기처럼 2초 딜레이 후 가짜 승인 응답을 반환.
//
// 실제 VAN 에이전트 수령 후 .env.local 에 아래 설정하면 이 mock은 무시됨:
//   NEXT_PUBLIC_CARD_TERMINAL_URL=http://localhost:7001

const FAKE_CARDS = [
  { cardName: '신한카드', cardLast4: '1234' },
  { cardName: 'KB국민카드', cardLast4: '5678' },
  { cardName: '현대카드', cardLast4: '9012' },
  { cardName: '삼성카드', cardLast4: '3456' },
  { cardName: '롯데카드', cardLast4: '7890' },
];

function genApprovalNo(): string {
  return String(Math.floor(10000000 + Math.random() * 90000000));
}

function formatDateTime(): string {
  const now = new Date();
  return now.toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const amount: number = body.amount || 0;

  // 2초 딜레이 — 실제 단말기 승인 대기 시뮬레이션
  await new Promise(r => setTimeout(r, 2000));

  // 금액 0원이면 오류 반환 (엣지케이스 테스트용)
  if (amount <= 0) {
    return NextResponse.json({
      resultCode: '9999',
      resultMsg: '금액 오류',
    });
  }

  const card = FAKE_CARDS[Math.floor(Math.random() * FAKE_CARDS.length)];
  const approvalNo = genApprovalNo();
  const now = formatDateTime();

  return NextResponse.json({
    resultCode: '0000',
    resultMsg: '정상승인',
    approvalNo,
    approvalDate: now.slice(0, 8),
    approvalTime: now.slice(8, 14),
    cardNo: `****-****-****-${card.cardLast4}`,
    cardName: card.cardName,
    installment: body.installment || '00',
    amount,
    taxAmount: body.taxAmount || 0,
    supplyAmount: body.supplyAmount || 0,
    merchantNo: '1234567890',
    _mock: true,   // 테스트 응답임을 표시
  });
}
