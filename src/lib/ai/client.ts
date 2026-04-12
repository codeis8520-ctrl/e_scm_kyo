// ─── 기존 인터페이스 유지 (route.ts 호환) ────────────────────────────────────

export interface MiniMaxMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: MiniMaxToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface MiniMaxToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface MiniMaxTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

// ─── Claude API 내부 타입 ─────────────────────────────────────────────────────

interface ClaudeContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, any>;
  tool_use_id?: string;
  content?: string;
}

interface ClaudeResponse {
  id: string;
  content: ClaudeContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  usage?: { input_tokens: number; output_tokens: number };
}

// ─── 형식 변환 ────────────────────────────────────────────────────────────────

/** OpenAI 도구 형식 → Claude 도구 형식 */
function toClaudeTools(tools: MiniMaxTool[]) {
  return tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: {
      type: 'object' as const,
      properties: t.function.parameters.properties,
      required: t.function.parameters.required || [],
    },
  }));
}

/** OpenAI 메시지 배열 → Claude 메시지 배열 + system 분리 */
function toClaudeMessages(messages: MiniMaxMessage[]): {
  system: string;
  messages: any[];
} {
  let system = '';
  const claudeMsgs: any[] = [];

  for (const m of messages) {
    if (m.role === 'system') {
      system += (system ? '\n\n' : '') + m.content;
      continue;
    }

    if (m.role === 'assistant') {
      const content: ClaudeContentBlock[] = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          let input: Record<string, any> = {};
          try { input = JSON.parse(tc.function.arguments); } catch { input = {}; }
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
      }
      if (content.length > 0) {
        claudeMsgs.push({ role: 'assistant', content });
      }
      continue;
    }

    if (m.role === 'tool') {
      // tool 결과는 이전 user 메시지에 합치거나 새 user 메시지 생성
      const toolResult: ClaudeContentBlock = {
        type: 'tool_result',
        tool_use_id: m.tool_call_id || '',
        content: m.content || '',
      };
      // 직전이 user(tool_result)면 합치기
      const last = claudeMsgs[claudeMsgs.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        last.content.push(toolResult);
      } else {
        claudeMsgs.push({ role: 'user', content: [toolResult] });
      }
      continue;
    }

    // user
    claudeMsgs.push({ role: 'user', content: m.content || '' });
  }

  return { system, messages: claudeMsgs };
}

/** Claude 응답 → OpenAI 호환 형식 */
function fromClaudeResponse(res: ClaudeResponse): {
  message: MiniMaxMessage;
  finish_reason: string;
} {
  let textContent = '';
  const toolCalls: MiniMaxToolCall[] = [];

  for (const block of res.content) {
    if (block.type === 'text' && block.text) {
      textContent += block.text;
    }
    if (block.type === 'tool_use' && block.id && block.name) {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input || {}),
        },
      });
    }
  }

  return {
    message: {
      role: 'assistant',
      content: textContent,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    },
    finish_reason: res.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
  };
}

// ─── Claude 클라이언트 ────────────────────────────────────────────────────────

export class MiniMaxClient {
  private apiKey: string;
  private model: string;

  constructor() {
    this.apiKey = process.env.ANTHROPIC_API_KEY || process.env.MINIMAX_API_KEY || '';
    this.model = process.env.AI_MODEL || 'claude-haiku-4-5-20251001';
  }

  async chatWithTools(messages: MiniMaxMessage[], tools?: MiniMaxTool[]): Promise<{
    message: MiniMaxMessage;
    finish_reason: string;
  }> {
    if (!this.apiKey) {
      throw new Error('AI API 키가 설정되지 않았습니다. (ANTHROPIC_API_KEY)');
    }

    const { system, messages: claudeMsgs } = toClaudeMessages(messages);

    const body: any = {
      model: this.model,
      max_tokens: 2048,
      system,
      messages: claudeMsgs,
    };

    if (tools && tools.length > 0) {
      body.tools = toClaudeTools(tools);
      body.tool_choice = { type: 'auto' };
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Claude] ${res.status}:`, errText.substring(0, 500));

      // 429 Rate limit → 잠시 대기 후 1회 재시도
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after') || '5');
        console.log(`[Claude] Rate limited, waiting ${retryAfter}s...`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));

        const retryRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        if (retryRes.ok) {
          const retryData: ClaudeResponse = await retryRes.json();
          return fromClaudeResponse(retryData);
        }
        const retryErr = await retryRes.text();
        throw new Error(`Claude API 오류 (재시도 실패): ${retryRes.status} - ${retryErr.substring(0, 200)}`);
      }

      throw new Error(`Claude API 오류: ${res.status} - ${errText.substring(0, 300)}`);
    }

    const data: ClaudeResponse = await res.json();
    return fromClaudeResponse(data);
  }

  async chat(messages: MiniMaxMessage[]): Promise<string> {
    const result = await this.chatWithTools(messages);
    return result.message.content;
  }
}

export const miniMaxClient = new MiniMaxClient();
