import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { miniMaxClient, MiniMaxMessage } from '@/lib/ai/client';
import { AGENT_TOOLS, WRITE_TOOLS, executeTool } from '@/lib/ai/tools';
import { DB_SCHEMA, BUSINESS_RULES } from '@/lib/ai/schema';

const SYSTEM_PROMPT = `당신은 경옥채 사내 통합시스템의 AI 직원 어시스턴트입니다.
사용자의 자연어 질문을 이해하고 제공된 도구를 사용해 실제 데이터를 조회하거나 작업을 수행합니다.
항상 한국어로 자연스럽고 친절하게 응답하세요.

== 원칙 ==
- 정보 조회는 즉시 도구를 사용해 실제 데이터로 답변하세요.
- 재고 이동, 포인트 조정, 등급 변경 등 데이터 변경 작업은 사용자 확인 후 실행됩니다.
- 모호한 경우 명확히 질문하세요.
- 숫자는 천 단위 쉼표(,)로 포맷하세요.

${DB_SCHEMA}

${BUSINESS_RULES}`;

interface AgentRequest {
  message: string;
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
    const { message, context, confirm, pending_action } = body;

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
          message: responseMsg.content || '요청을 처리했습니다.',
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
    default:
      return `⚠️ 작업을 실행하시겠습니까?\n\n${JSON.stringify(args, null, 2)}`;
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok', message: 'AI Agent API is running' });
}
