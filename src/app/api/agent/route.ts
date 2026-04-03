import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { miniMaxClient, MiniMaxMessage } from '@/lib/ai/client';
import { AGENT_TOOLS, WRITE_TOOLS, executeTool } from '@/lib/ai/tools';
import { DB_SCHEMA, BUSINESS_RULES } from '@/lib/ai/schema';

const SYSTEM_PROMPT = `당신은 경옥채 사내 통합시스템의 AI 직원 어시스턴트입니다.
사용자의 자연어 요청을 이해하고 제공된 도구를 사용해 실제 데이터를 조회하거나 업무를 처리합니다.
항상 한국어로 자연스럽고 친절하게 응답하세요.

== 앱 메뉴 구조 ==
- 대시보드: 채널/지점별 매출 현황 조회
- POS: 판매(결제) 처리
- 제품: 제품 목록 관리 (등록/수정)
- 생산: 생산 지시 및 BOM 관리
- 재고: 재고 현황, 입출고, 지점 간 이동
- 고객: 고객 등록/조회/수정, 상담 기록, 포인트 관리
- 알림: 알림톡/SMS 발송
- 코드: 지점 관리, 고객 등급, 태그, 카테고리, 직원 관리
- 보고서: 기간별 매출 보고서

== 원칙 ==
- 정보 조회는 즉시 도구를 사용해 실제 데이터로 답변하세요.
- 재고 이동, 지점 추가, 고객 등록, 포인트 조정 등 데이터 변경은 사용자 확인 후 실행됩니다.
- 모호한 필수 정보가 있으면 먼저 질문하세요 (예: 지점 추가 시 채널 유형).
- 절대로 "DB에 직접 접근하세요" "관리자 도구를 사용하세요" 같은 말을 하지 마세요.
  모든 작업은 도구를 통해 직접 처리하거나 앱 메뉴를 안내하는 방식으로 응답하세요.
- 숫자는 천 단위 쉼표(,)로 포맷하세요.

${DB_SCHEMA}

${BUSINESS_RULES}`;

interface AgentRequest {
  message: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  context?: {
    userId?: string;
    userRole?: string;
    branchId?: string;
  };
  // For confirmed write actions
  confirm?: boolean;
  pending_action?: {
    tool: string;
    args: Record<string, any>;
    description: string;
  };
}

export async function POST(req: NextRequest) {
  try {
    const body: AgentRequest = await req.json();
    const { message, history, context, confirm, pending_action } = body;

    if (!message && !confirm) {
      return NextResponse.json({ error: '메시지가 필요합니다.' }, { status: 400 });
    }

    const supabase = await createClient();

    // ── Confirmed write action: skip LLM, execute directly ──────────────────
    if (confirm && pending_action) {
      const result = await executeTool(pending_action.tool, pending_action.args, supabase);
      const parsed = JSON.parse(result);
      if (parsed.error) {
        return NextResponse.json({ type: 'error', message: parsed.error });
      }
      return NextResponse.json({ type: 'success', message: parsed.메시지 || '작업이 완료되었습니다.' });
    }

    // ── Build messages ───────────────────────────────────────────────────────
    const contextNote = [
      context?.userRole ? `현재 사용자 역할: ${context.userRole}` : '',
      context?.branchId ? `담당 지점 ID: ${context.branchId}` : '',
    ].filter(Boolean).join('\n');

    const systemContent = contextNote
      ? `${SYSTEM_PROMPT}\n\n== 현재 사용자 ==\n${contextNote}`
      : SYSTEM_PROMPT;

    const messages: MiniMaxMessage[] = [
      { role: 'system', content: systemContent },
      ...(history || []).map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message },
    ];

    // ── Agentic loop (max 5 iterations to prevent infinite loops) ────────────
    for (let i = 0; i < 5; i++) {
      const { message: responseMsg, finish_reason } = await miniMaxClient.chatWithTools(
        messages,
        AGENT_TOOLS
      );

      messages.push(responseMsg);

      // No tool calls → final answer
      if (finish_reason !== 'tool_calls' || !responseMsg.tool_calls?.length) {
        return NextResponse.json({
          type: 'success',
          message: stripThinkTags(responseMsg.content) || '요청을 처리했습니다.',
        });
      }

      // Process each tool call
      for (const toolCall of responseMsg.tool_calls) {
        const toolName = toolCall.function.name;
        let args: Record<string, any> = {};
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          args = {};
        }

        // Write tool → return confirmation request (don't execute)
        if (WRITE_TOOLS.has(toolName)) {
          const description = buildConfirmDescription(toolName, args);
          return NextResponse.json({
            type: 'confirm',
            message: description,
            pending_action: { tool: toolName, args, description },
          });
        }

        // Read tool → execute and append result
        const result = await executeTool(toolName, args, supabase);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolName,
          content: result,
        });
      }
    }

    return NextResponse.json({
      type: 'error',
      message: '응답을 처리하는 중 문제가 발생했습니다. 다시 시도해주세요.',
    });

  } catch (error: any) {
    console.error('[Agent] Error:', error.message);
    return NextResponse.json(
      { type: 'error', message: error.message || '서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

function stripThinkTags(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function buildConfirmDescription(toolName: string, args: Record<string, any>): string {
  switch (toolName) {
    case 'transfer_inventory':
      return `⚠️ 재고 이동 확인\n\n` +
        `• 출발지: ${args.from_branch_name}\n` +
        `• 도착지: ${args.to_branch_name}\n` +
        `• 제품: ${args.product_name}\n` +
        `• 수량: ${args.quantity}개\n\n` +
        `이동하시겠습니까?`;
    case 'adjust_points':
      const customer = args.customer_name || args.phone || '고객';
      const sign = args.points > 0 ? '+' : '';
      return `⚠️ 포인트 조정 확인\n\n` +
        `• 고객: ${customer}\n` +
        `• 조정: ${sign}${args.points}P\n` +
        `• 사유: ${args.reason}\n\n` +
        `실행하시겠습니까?`;
    case 'update_customer_grade':
      const gradeNames: Record<string, string> = { NORMAL: '일반', VIP: 'VIP', VVIP: 'VVIP' };
      return `⚠️ 등급 변경 확인\n\n` +
        `• 고객: ${args.customer_name || args.phone || '고객'}\n` +
        `• 변경 등급: ${gradeNames[args.new_grade] || args.new_grade}\n\n` +
        `변경하시겠습니까?`;
    case 'create_branch':
      const channelNames: Record<string, string> = { STORE: '한약국', DEPT_STORE: '백화점', ONLINE: '자사몰', EVENT: '이벤트' };
      return `⚠️ 지점 추가 확인\n\n` +
        `• 지점명: ${args.name}\n` +
        `• 채널: ${channelNames[args.channel] || args.channel}\n` +
        (args.address ? `• 주소: ${args.address}\n` : '') +
        (args.phone ? `• 전화: ${args.phone}\n` : '') +
        `\n추가하시겠습니까?`;
    case 'update_branch':
      return `⚠️ 지점 수정 확인\n\n` +
        `• 대상 지점: ${args.branch_name}\n` +
        (args.new_name ? `• 새 이름: ${args.new_name}\n` : '') +
        (args.address ? `• 주소: ${args.address}\n` : '') +
        (args.phone ? `• 전화: ${args.phone}\n` : '') +
        (args.is_active !== undefined ? `• 상태: ${args.is_active ? '활성화' : '비활성화'}\n` : '') +
        `\n수정하시겠습니까?`;
    case 'create_customer':
      const gradeMap: Record<string, string> = { NORMAL: '일반', VIP: 'VIP', VVIP: 'VVIP' };
      return `⚠️ 고객 등록 확인\n\n` +
        `• 이름: ${args.name}\n` +
        `• 전화번호: ${args.phone}\n` +
        `• 등급: ${gradeMap[args.grade || 'NORMAL'] || args.grade || '일반'}\n` +
        (args.email ? `• 이메일: ${args.email}\n` : '') +
        `\n등록하시겠습니까?`;
    case 'update_customer':
      const target = args.customer_name || args.phone || '고객';
      return `⚠️ 고객 정보 수정 확인\n\n` +
        `• 고객: ${target}\n` +
        (args.grade ? `• 등급: ${args.grade}\n` : '') +
        (args.new_phone ? `• 전화번호: ${args.new_phone}\n` : '') +
        (args.email ? `• 이메일: ${args.email}\n` : '') +
        (args.address ? `• 주소: ${args.address}\n` : '') +
        `\n수정하시겠습니까?`;
    default:
      return `⚠️ 작업을 실행하시겠습니까?\n\n${JSON.stringify(args, null, 2)}`;
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok', message: 'AI Agent API is running' });
}
