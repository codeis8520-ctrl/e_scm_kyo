import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { miniMaxClient, MiniMaxMessage } from '@/lib/ai/client';
import { AGENT_TOOLS, WRITE_TOOLS, executeTool } from '@/lib/ai/tools';
import { DB_SCHEMA, BUSINESS_RULES } from '@/lib/ai/schema';
import { loadMemories, extractMemory, extractMemoryFromWrite } from '@/lib/ai/memory';

const SYSTEM_PROMPT = `당신은 경옥채(한약·건강기능식품 전문 기업)의 사내 ERP AI 직원입니다.
직원이 자연어로 요청하면 도구를 사용해 실제 데이터를 조회·처리합니다.

== 역할 ==
조회: 재고·부족품목·제품·지점·고객·포인트·주문·매출·발주·생산지시서
처리: 재고조정·이동, 고객등록·수정·등급·포인트, 발주·입고, 생산지시, SMS 발송
분석: 매출 비교, 상위 제품, 재고 부족 알림

== 핵심 행동 규칙 ==
0. 날짜/시간은 반드시 "현재 사용자" 섹션의 오늘 날짜를 사용한다. 학습 데이터의 날짜를 절대 사용하지 않는다.
1. 조회 요청 → 즉시 도구 호출 → 실데이터 기반 답변. 추측하지 않는다.
2. 데이터 변경(재고·고객·발주·생산 등) → 반드시 확인 단계 후 실행.
3. 이름·지점·제품이 불분명하면 → 먼저 조회 도구로 확인 후 작업.
4. 한 번에 하나의 도구만 호출한다. 여러 작업이 필요하면 순서대로 처리.
5. BRANCH_STAFF/PHARMACY_STAFF 역할 → 담당 지점 업무만 처리.

== 도구 호출 규칙 (중요) ==
- 선택적 파라미터는 값이 없으면 아예 생략한다. null이나 "null"을 보내지 않는다.
- number 타입 파라미터(limit, quantity 등)는 반드시 숫자로 보낸다. 문자열 "20"이 아니라 20.
- 도구 호출 시 반드시 올바른 JSON 형식의 arguments를 사용한다.
6. 금액은 천단위 쉼표 + "원", 수량은 숫자 + 단위(개/g/ml 등).
7. 답변은 핵심만 간결하게. 불필요한 안내문·사과·목록 나열 금지.
8. 지원 안 되는 기능: "해당 기능은 현재 지원하지 않습니다." 한 줄만.
9. 내부 시스템·DB 관련 용어를 사용자에게 노출하지 않는다.
10. 응답은 완결된 문장으로 끝낸다.

== 도구 선택 가이드 ==
"재고 몇개야?" → get_inventory
"부족한 거 뭐야?" → get_low_stock
"이번달 매출" → get_sales_summary(period:"this_month")
"지난달 대비" → compare_sales
"XX 고객 찾아줘" → get_customer
"재고 X개 넣어줘/채워줘" → adjust_inventory(movement_type:"IN") ← 발주 불필요
"발주해줘" → create_purchase_order → confirm → receive 순서
"생산 지시" → create_production_order → start → complete 순서
"문자 보내줘" → send_sms(개별) 또는 bulk_send_sms(일괄)

== 복합 분석 질문 ==
기존 도구로 답할 수 없는 복합 분석(교차 집계, 조건부 필터링, 추세 분석 등)은
analyze_data 도구로 SELECT SQL을 직접 작성하여 실행한다.
- 반드시 기존 도구를 먼저 검토 후, 없을 때만 사용
- PostgreSQL 문법, 테이블·컬럼명은 스키마 참조
- SELECT만 허용 (INSERT/UPDATE/DELETE 불가)
- users, session_tokens 등 보안 테이블 접근 불가

${DB_SCHEMA}
${BUSINESS_RULES}`;

interface AgentRequest {
  message: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  context?: { userId?: string; userRole?: string; branchId?: string };
  confirm?: boolean;
  pending_action?: { tool: string; args: Record<string, any>; description: string };
}

export async function POST(req: NextRequest) {
  try {
    const body: AgentRequest = await req.json();
    const { message, history, context, confirm, pending_action } = body;

    if (!message && !confirm) {
      return NextResponse.json({ error: '메시지가 필요합니다.' }, { status: 400 });
    }

    const supabase = await createClient();

    const db = supabase as any;

    // ── 확정된 쓰기 작업: LLM 없이 바로 실행 ────────────────────────────────
    if (confirm && pending_action) {
      const result = await executeTool(pending_action.tool, pending_action.args, supabase, context || {});
      const parsed = JSON.parse(result);
      // 쓰기 결과 메모리 저장 (비동기 fire-and-forget)
      extractMemoryFromWrite(db, pending_action.tool, pending_action.args, parsed).catch(() => {});
      if (parsed.error) {
        return NextResponse.json({ type: 'error', message: `❌ ${parsed.error}` });
      }
      const msg = parsed.메시지 || parsed.결과 || '작업이 완료되었습니다.';
      const detail = buildSuccessDetail(pending_action.tool, parsed);
      return NextResponse.json({ type: 'success', message: detail ? `✅ ${msg}\n\n${detail}` : `✅ ${msg}` });
    }

    // ── 메모리 로딩 ──────────────────────────────────────────────────────────
    const memories = await loadMemories(db).catch(() => '');

    // ── 사용자 컨텍스트 주입 ─────────────────────────────────────────────────
    const now = new Date();
    const today = now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });

    const roleLabels: Record<string, string> = {
      SUPER_ADMIN: '시스템관리자', HQ_OPERATOR: '본사운영자',
      PHARMACY_STAFF: '약국직원', BRANCH_STAFF: '지점직원', EXECUTIVE: '임원',
    };
    const contextLines = [
      `오늘: ${today}`,
      context?.userRole ? `역할: ${roleLabels[context.userRole] || context.userRole}` : '',
      context?.branchId ? `담당지점ID: ${context.branchId}` : '',
    ].filter(Boolean).join(' | ');

    const systemContent = [
      SYSTEM_PROMPT,
      contextLines ? `\n== 현재 사용자 == ${contextLines}` : '',
      memories ? `\n${memories}` : '',
    ].join('');

    const messages: MiniMaxMessage[] = [
      { role: 'system', content: systemContent },
      ...(history || []).slice(-6).map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message },
    ];

    // ── Agentic loop (최대 8회) ───────────────────────────────────────────────
    let finalResponse = '';
    const toolsUsed: string[] = [];

    for (let rounds = 0; rounds < 8; rounds++) {
      let responseMsg: any;
      let finish_reason: string;

      try {
        const res = await miniMaxClient.chatWithTools(messages, AGENT_TOOLS);
        responseMsg = res.message;
        finish_reason = res.finish_reason;
      } catch (err: any) {
        console.error(`[Agent] Round ${rounds} Groq error:`, err.message?.substring(0, 500));
        // 첫 라운드에서만 1회 재시도
        if (rounds === 0) {
          try {
            const res = await miniMaxClient.chatWithTools(messages, AGENT_TOOLS);
            responseMsg = res.message;
            finish_reason = res.finish_reason;
          } catch (retryErr: any) {
            console.error('[Agent] Retry also failed:', retryErr.message?.substring(0, 500));
            finalResponse = '일시적인 오류가 발생했습니다. 다시 시도해주세요.';
            break;
          }
        } else {
          finalResponse = '일시적인 오류가 발생했습니다. 다시 시도해주세요.';
          break;
        }
      }

      // assistant 메시지 추가
      messages.push({
        role: responseMsg.role || 'assistant',
        content: responseMsg.content || '',
        tool_calls: responseMsg.tool_calls,
      });

      // finish_reason이 tool_calls가 아니면 → 최종 응답
      if (finish_reason !== 'tool_calls' || !responseMsg.tool_calls?.length) {
        finalResponse = stripThinkTags(responseMsg.content) || '처리 완료';
        break;
      }

      // 쓰기 도구 감지 → 즉시 확인 요청 반환
      for (const toolCall of responseMsg.tool_calls) {
        const toolName = toolCall.function.name;
        let args: Record<string, any> = {};
        try { args = JSON.parse(toolCall.function.arguments); } catch { args = {}; }
        args = sanitizeToolArgs(args);

        if (WRITE_TOOLS.has(toolName)) {
          const description = buildConfirmDescription(toolName, args);
          return NextResponse.json({
            type: 'confirm',
            message: description,
            pending_action: { tool: toolName, args, description },
          });
        }
      }

      // 읽기 도구 → 실행 + 결과를 messages에 추가 (다음 라운드)
      for (const toolCall of responseMsg.tool_calls) {
        const toolName = toolCall.function.name;
        let args: Record<string, any> = {};
        try { args = JSON.parse(toolCall.function.arguments); } catch { args = {}; }
        args = sanitizeToolArgs(args);

        if (!WRITE_TOOLS.has(toolName)) {
          console.log(`[Agent] Round ${rounds}: ${toolName}(${JSON.stringify(args)})`);
          toolsUsed.push(toolName);
          try {
            const result = await executeTool(toolName, args, supabase, context || {});
            extractMemory(db, toolName, args, result).catch(() => {});
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolName,
              content: result,
            });
          } catch (toolErr: any) {
            console.error(`[Agent] Tool ${toolName} error:`, toolErr.message);
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolName,
              content: JSON.stringify({ error: toolErr.message || '도구 실행 오류' }),
            });
          }
        }
      }
    }

    if (toolsUsed.length > 0) {
      console.log(`[Agent] Completed. Tools: ${toolsUsed.join(', ')}`);
    }

    return NextResponse.json({
      type: finalResponse ? 'success' : 'error',
      message: finalResponse || '응답 처리 중 문제가 발생했습니다. 다시 시도해주세요.',
    });

  } catch (error: any) {
    console.error('[Agent] Unhandled error:', error.message);
    return NextResponse.json({ type: 'error', message: '일시적인 오류가 발생했습니다. 다시 시도해주세요.' }, { status: 500 });
  }
}

/** Llama 모델 tool calling 인자 정제 — "null" 문자열 제거, 숫자 문자열 변환 */
function sanitizeToolArgs(args: Record<string, any>): Record<string, any> {
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(args)) {
    // "null", "None", "undefined" 문자열 → 제거
    if (typeof value === 'string' && /^(null|none|undefined)$/i.test(value.trim())) continue;
    // 빈 문자열 → 제거
    if (value === '') continue;
    // 숫자 문자열 → number 변환 (limit, quantity 등)
    if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) {
      cleaned[key] = Number(value);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

function stripThinkTags(content: string | null | undefined): string {
  if (!content) return '';
  return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function buildSuccessDetail(tool: string, parsed: any): string {
  switch (tool) {
    case 'upgrade_customer_grades':
      return parsed.상세?.length ? parsed.상세.slice(0, 5).join('\n') + (parsed.상세.length > 5 ? `\n외 ${parsed.상세.length - 5}명` : '') : '';
    case 'complete_production_order':
      return `완제품: ${parsed.완제품} ${parsed.생산량}개\n지점: ${parsed.지점}`;
    case 'receive_purchase_order':
      return `입고전표: ${parsed.입고전표}\n${(parsed.입고항목 || []).join(', ')}`;
    case 'create_purchase_order':
      return `발주번호: ${parsed.발주번호}\n${parsed.제품} ${parsed.수량}개 × ${parsed.단가} = ${parsed.합계}`;
    case 'create_production_order':
      return `지시번호: ${parsed.지시번호}\n소요재료: ${parsed.소요재료}`;
    case 'bulk_adjust_inventory':
      return `지점 ${parsed.대상지점수}개 × 제품 ${parsed.대상제품수}개\n성공 ${parsed.처리성공}${parsed.처리실패 !== '없음' ? ` / 실패 ${parsed.처리실패}` : ''}`;
    case 'adjust_inventory':
      return `이전: ${parsed.이전재고}개 → 변경후: ${parsed.변경후재고}개`;
    case 'adjust_points':
      return `${parsed.이전잔액} → ${parsed.변경후잔액}`;
    case 'bulk_send_sms':
      return `발송 대상: ${parsed.발송대상}`;
    case 'create_and_confirm_purchase_order':
      return `발주번호: ${parsed.발주번호}\n${parsed.제품} ${parsed.수량}개 × ${parsed.단가} = ${parsed.합계} (${parsed.상태})`;
    case 'replenish_low_stock':
      return `${(parsed.상세 || []).slice(0, 5).join('\n')}${(parsed.상세 || []).length > 5 ? `\n외 ${parsed.상세.length - 5}건` : ''}`;
    case 'add_customer_consultation':
      return `유형: ${parsed.상담유형}\n내용: ${parsed.내용}`;
    case 'update_product':
      return parsed.변경내용 || '';
    case 'bulk_update_product_costs':
      return `${parsed.기준}\n${(parsed.상세 || []).slice(0, 5).join('\n')}${parsed.안내 ? `\n${parsed.안내}` : ''}`;
    default:
      return '';
  }
}

const CHANNEL_NAMES: Record<string, string> = { STORE: '한약국', DEPT_STORE: '백화점', ONLINE: '자사몰', EVENT: '이벤트' };
const GRADE_NAMES: Record<string, string> = { NORMAL: '일반', VIP: 'VIP', VVIP: 'VVIP' };

function buildConfirmDescription(toolName: string, args: Record<string, any>): string {
  const lines: string[] = [];
  const add = (label: string, value: any) => { if (value !== undefined && value !== null) lines.push(`• ${label}: ${value}`); };

  switch (toolName) {
    case 'bulk_adjust_inventory': {
      const typeLabel2: Record<string, string> = { IN: '입고(+)', OUT: '출고(-)', ADJUST: '실사(=)' };
      lines.push('📦 대량 재고 조정 확인');
      add('대상 지점', args.branch_name || '전체 지점');
      add('대상 제품', args.product_name || '전체 제품');
      add('유형', typeLabel2[args.movement_type] || args.movement_type);
      add('수량', `각 항목 ${args.quantity}개`);
      add('메모', args.memo);
      lines.push('⚠️ 대상이 많을 경우 처리 시간이 걸릴 수 있습니다.');
      break;
    }
    case 'adjust_inventory': {
      const typeLabel: Record<string, string> = { IN: '입고(+)', OUT: '출고(-)', ADJUST: '실사(=)' };
      lines.push('📦 재고 조정 확인');
      add('지점', args.branch_name); add('제품', args.product_name);
      add('유형', typeLabel[args.movement_type] || args.movement_type);
      add('수량', `${args.quantity}개`); add('메모', args.memo);
      break;
    }
    case 'transfer_inventory':
      lines.push('🔄 재고 이동 확인');
      add('출발 지점', args.from_branch_name); add('도착 지점', args.to_branch_name);
      add('제품', args.product_name); add('수량', `${args.quantity}개`);
      break;
    case 'create_customer':
      lines.push('👤 고객 등록 확인');
      add('이름', args.name); add('전화번호', args.phone);
      add('등급', GRADE_NAMES[args.grade] || args.grade || '일반');
      add('이메일', args.email); add('주소', args.address);
      break;
    case 'add_customer_consultation':
      lines.push('📝 상담 기록 추가 확인');
      add('고객', args.customer_name || args.phone);
      add('상담 유형', args.consultation_type);
      lines.push(`• 내용: "${args.content.slice(0, 80)}${args.content.length > 80 ? '...' : ''}"`);
      break;
    case 'update_customer':
      lines.push('✏️ 고객 정보 수정 확인');
      add('대상 고객', args.customer_name || args.phone);
      add('새 전화번호', args.new_phone); add('이메일', args.email);
      add('주소', args.address); add('등급', args.grade ? GRADE_NAMES[args.grade] || args.grade : undefined);
      break;
    case 'update_customer_grade':
      lines.push('🏷️ 고객 등급 변경 확인');
      add('고객', args.customer_name || args.phone);
      add('변경 등급', GRADE_NAMES[args.new_grade] || args.new_grade);
      break;
    case 'upgrade_customer_grades':
      lines.push('🔼 전체 등급 자동 업그레이드 확인');
      lines.push('• 기준: 누적 구매 100만원↑ → VIP, 300만원↑ → VVIP');
      lines.push('• 다운그레이드는 적용되지 않습니다.');
      break;
    case 'adjust_points':
      lines.push(`${args.points > 0 ? '➕' : '➖'} 포인트 조정 확인`);
      add('고객', args.customer_name || args.phone);
      add('조정', `${args.points > 0 ? '+' : ''}${args.points}P`);
      add('사유', args.reason);
      break;
    case 'create_branch':
      lines.push('🏪 지점 추가 확인');
      add('지점명', args.name); add('채널', CHANNEL_NAMES[args.channel] || args.channel);
      add('주소', args.address); add('전화', args.phone);
      break;
    case 'update_branch':
      lines.push('🏪 지점 수정 확인');
      add('대상', args.branch_name); add('새 이름', args.new_name);
      add('주소', args.address); add('전화', args.phone);
      if (args.is_active !== undefined) add('상태', args.is_active ? '활성화' : '비활성화');
      break;
    case 'create_product':
      lines.push('📦 제품 등록 확인');
      add('제품명', args.name); add('판매가', args.price ? `${Number(args.price).toLocaleString()}원` : undefined);
      add('원가', args.cost ? `${Number(args.cost).toLocaleString()}원` : undefined);
      add('단위', args.unit || '개');
      break;
    case 'create_purchase_order':
      lines.push('📋 발주서 작성 확인');
      add('공급업체', args.supplier_name); add('입고 지점', args.branch_name);
      add('제품', args.product_name); add('수량', `${args.quantity}개`);
      add('단가', `${Number(args.unit_price).toLocaleString()}원`);
      add('합계', `${(args.quantity * args.unit_price).toLocaleString()}원`);
      add('메모', args.memo);
      break;
    case 'confirm_purchase_order':
      lines.push('✅ 발주서 확정 확인');
      add('발주번호', args.order_number);
      lines.push('• 확정 후에는 수정이 불가합니다.');
      break;
    case 'receive_purchase_order':
      lines.push('📥 입고 처리 확인');
      add('발주번호', args.order_number);
      add('메모', args.memo);
      lines.push('• 재고가 자동으로 증가합니다.');
      break;
    case 'create_production_order':
      lines.push('🏭 생산 지시서 생성 확인');
      add('제품', args.product_name); add('지점', args.branch_name);
      add('수량', `${args.quantity}개`); add('메모', args.memo);
      break;
    case 'start_production_order':
      lines.push('▶️ 생산 착수 확인');
      add('지시번호', args.order_number);
      break;
    case 'complete_production_order':
      lines.push('🎯 생산 완료 확인');
      add('지시번호', args.order_number);
      lines.push('• BOM 원재료가 재고에서 차감됩니다.');
      lines.push('• 완제품 재고가 증가합니다.');
      break;
    case 'send_sms':
      lines.push('📱 SMS 발송 확인');
      add('수신자', args.customer_name || args.phone);
      lines.push(`• 내용: "${args.message.slice(0, 50)}${args.message.length > 50 ? '...' : ''}"`);
      break;
    case 'bulk_send_sms': {
      const gradeLabel: Record<string, string> = { NORMAL: '일반', VIP: 'VIP', VVIP: 'VVIP', ALL: '전체' };
      lines.push('📢 일괄 SMS 발송 확인');
      add('대상 등급', gradeLabel[args.grade] || args.grade);
      if (args.branch_name) add('지점 필터', args.branch_name);
      lines.push(`• 내용: "${args.message.slice(0, 50)}${args.message.length > 50 ? '...' : ''}"`);
      lines.push('⚠️ 해당 등급 고객 전체에게 발송됩니다.');
      break;
    }
    case 'create_and_confirm_purchase_order':
      lines.push('📋 발주서 작성 + 즉시 확정');
      add('공급업체', args.supplier_name); add('입고 지점', args.branch_name);
      add('제품', args.product_name); add('수량', `${args.quantity}개`);
      add('단가', `${Number(args.unit_price).toLocaleString()}원`);
      add('합계', `${(args.quantity * args.unit_price).toLocaleString()}원`);
      add('메모', args.memo);
      lines.push('• 생성과 동시에 확정됩니다 (수정 불가).');
      break;
    case 'replenish_low_stock':
      lines.push('📦 안전재고 자동 보충 확인');
      add('대상 지점', args.branch_name || '전체 지점');
      add('보충 기준', args.fill_to_safety === false ? `고정 ${args.fixed_quantity}개` : '안전재고 수준까지');
      add('메모', args.memo);
      lines.push('⚠️ 안전재고 미달 품목에 일괄 입고 처리됩니다.');
      break;
    case 'update_product':
      lines.push('✏️ 제품 정보 수정 확인');
      add('대상 제품', args.product_name);
      if (args.new_price !== undefined) add('판매가', `${Number(args.new_price).toLocaleString()}원`);
      if (args.new_cost !== undefined) add('원가', `${Number(args.new_cost).toLocaleString()}원`);
      if (args.new_name !== undefined) add('새 제품명', args.new_name);
      if (args.new_unit !== undefined) add('단위', args.new_unit);
      break;
    case 'bulk_update_product_costs': {
      const pct = Math.round((args.cost_ratio || 0) * 100);
      lines.push('💰 제품 원가 일괄 업데이트 확인');
      add('대상', args.product_name || '전체 제품');
      add('원가 기준', `판매가의 ${pct}%`);
      lines.push('⚠️ 대상 제품 전체의 원가(cost)가 변경됩니다.');
      break;
    }
    case 'delete_record': {
      const tableLabels: Record<string, string> = { customer_consultations: '상담 기록', notifications: '발송 이력' };
      lines.push(`🗑️ ${tableLabels[args.table] || args.table} 삭제 확인`);
      add('테이블', tableLabels[args.table] || args.table);
      add('레코드 ID', args.record_id);
      add('사유', args.reason);
      lines.push('⚠️ 삭제 후 복구할 수 없습니다.');
      break;
    }
    // ── Phase B ─────────────────────────────────────────────────────────
    case 'refund_sales_order': {
      const reasonLabels: Record<string, string> = {
        DEFECTIVE: '불량/하자', WRONG_ITEM: '오배송', CHANGE_OF_MIND: '단순 변심', DUPLICATE: '중복 구매', OTHER: '기타',
      };
      lines.push('💸 환불 처리 확인');
      add('원주문번호', args.order_number);
      add('환불 사유', reasonLabels[args.reason] || args.reason);
      add('환불 유형', args.full_refund !== false && !args.items?.length ? '전액 환불' : '부분 환불');
      if (args.items?.length) {
        lines.push('• 환불 항목:');
        (args.items as any[]).slice(0, 5).forEach(it => lines.push(`  - ${it.product_name} × ${it.quantity}`));
      }
      add('환불 수단', args.refund_method || '원 결제수단과 동일');
      lines.push('⚠️ 재고 복원 + 포인트 차감 + 환불 전표가 자동 생성됩니다.');
      break;
    }
    case 'receive_purchase_order_partial':
      lines.push('📥 부분 입고 처리 확인');
      add('발주번호', args.order_number);
      lines.push('• 입고 항목:');
      (args.items as any[] || []).slice(0, 8).forEach(it => lines.push(`  - ${it.product_name} × ${it.quantity}개`));
      add('메모', args.memo);
      lines.push('• 재고가 자동으로 증가하며, 미입고분은 PARTIALLY_RECEIVED로 유지됩니다.');
      break;
    case 'update_shipment_tracking':
      lines.push('🚚 배송 송장번호 등록 확인');
      add('수령자', args.recipient_name);
      add('카페24 주문ID', args.cafe24_order_id);
      add('송장번호', args.tracking_number);
      lines.push('• 상태가 자동으로 "발송완료"로 전환됩니다.');
      break;
    case 'refresh_cafe24_token':
      lines.push('🔄 카페24 토큰 갱신 확인');
      lines.push('• access_token / refresh_token을 카페24 API로 재발급합니다.');
      break;
    case 'sync_cafe24_paid_orders':
      lines.push('💰 카페24 결제완료 매출 동기화 확인');
      add('기간', `${args.start_date} ~ ${args.end_date}`);
      lines.push('⚠️ 기간 내 결제완료 주문을 sales_orders에 일괄 upsert하고 매출 분개를 생성합니다.');
      break;
    default:
      return `⚠️ 작업 확인\n\n${JSON.stringify(args, null, 2)}`;
  }

  lines.push('', '실행하시겠습니까?');
  return lines.join('\n');
}

export async function GET() {
  return NextResponse.json({ status: 'ok', tools: AGENT_TOOLS.length });
}
