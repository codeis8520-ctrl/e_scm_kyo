// ─── 기존 인터페이스 유지 (route.ts 호환) ────────────────────────────────────

// 멀티모달 입력 블록 — user 메시지에서만 사용. assistant/tool은 string 유지.
export type UserContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };

export interface MiniMaxMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | UserContentBlock[];
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

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
}

// ─── Claude API 내부 타입 ─────────────────────────────────────────────────────

interface ClaudeContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image' | 'document';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, any>;
  tool_use_id?: string;
  content?: string;
  source?: { type: 'base64'; media_type: string; data: string };
}

interface ClaudeResponse {
  id: string;
  content: ClaudeContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

// ─── 형식 변환 ────────────────────────────────────────────────────────────────

/** OpenAI 도구 형식 → Claude 도구 형식 (마지막 도구에 cache_control 적용) */
function toClaudeTools(tools: MiniMaxTool[]) {
  const claudeTools = tools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: {
      type: 'object' as const,
      properties: t.function.parameters.properties,
      required: t.function.parameters.required || [],
    },
  }));
  // 마지막 도구에 cache_control → 전체 도구 목록 캐싱
  if (claudeTools.length > 0) {
    (claudeTools[claudeTools.length - 1] as any).cache_control = { type: 'ephemeral' };
  }
  return claudeTools;
}

/**
 * OpenAI 메시지 배열 → Claude 메시지 배열 + system 분리
 * system 메시지를 static(캐싱 대상) / dynamic(매 요청 변경)으로 분리
 */
function toClaudeMessages(messages: MiniMaxMessage[]): {
  systemParts: string[];
  messages: any[];
} {
  const systemParts: string[] = [];
  const claudeMsgs: any[] = [];

  for (const m of messages) {
    if (m.role === 'system') {
      // system은 항상 string
      systemParts.push(typeof m.content === 'string' ? m.content : '');
      continue;
    }

    if (m.role === 'assistant') {
      const content: ClaudeContentBlock[] = [];
      const text = typeof m.content === 'string' ? m.content : '';
      if (text) content.push({ type: 'text', text });
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
      const toolResult: ClaudeContentBlock = {
        type: 'tool_result',
        tool_use_id: m.tool_call_id || '',
        content: typeof m.content === 'string' ? m.content : '',
      };
      const last = claudeMsgs[claudeMsgs.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        last.content.push(toolResult);
      } else {
        claudeMsgs.push({ role: 'user', content: [toolResult] });
      }
      continue;
    }

    // user — string은 그대로, 배열(멀티모달)은 그대로 전달
    if (Array.isArray(m.content)) {
      claudeMsgs.push({ role: 'user', content: m.content });
    } else {
      claudeMsgs.push({ role: 'user', content: m.content || '' });
    }
  }

  return { systemParts, messages: claudeMsgs };
}

/** Claude 응답 → OpenAI 호환 형식 + usage */
function fromClaudeResponse(res: ClaudeResponse): {
  message: MiniMaxMessage;
  finish_reason: string;
  usage: TokenUsage;
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
    usage: {
      input_tokens: res.usage?.input_tokens || 0,
      output_tokens: res.usage?.output_tokens || 0,
      cache_read_tokens: res.usage?.cache_read_input_tokens || 0,
      cache_creation_tokens: res.usage?.cache_creation_input_tokens || 0,
    },
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

  private getHeaders(): HeadersInit {
    return {
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
      'content-type': 'application/json',
    };
  }

  async chatWithTools(messages: MiniMaxMessage[], tools?: MiniMaxTool[]): Promise<{
    message: MiniMaxMessage;
    finish_reason: string;
    usage: TokenUsage;
  }> {
    if (!this.apiKey) {
      throw new Error('AI API 키가 설정되지 않았습니다. (ANTHROPIC_API_KEY)');
    }

    const { systemParts, messages: claudeMsgs } = toClaudeMessages(messages);

    // system 프롬프트: 첫 번째(정적) → cache_control, 나머지(동적) → 캐싱 안 함
    const systemBlocks: any[] = [];
    if (systemParts.length > 0) {
      // 첫 번째 system 메시지 = 정적 (SYSTEM_PROMPT + DB_SCHEMA + BUSINESS_RULES)
      systemBlocks.push({
        type: 'text',
        text: systemParts[0],
        cache_control: { type: 'ephemeral' },
      });
      // 나머지 system 메시지 = 동적 (사용자 컨텍스트 + 메모리)
      for (let i = 1; i < systemParts.length; i++) {
        if (systemParts[i].trim()) {
          systemBlocks.push({ type: 'text', text: systemParts[i] });
        }
      }
    }

    const body: any = {
      model: this.model,
      max_tokens: 2048,
      system: systemBlocks.length > 0 ? systemBlocks : undefined,
      messages: claudeMsgs,
    };

    if (tools && tools.length > 0) {
      body.tools = toClaudeTools(tools);
      body.tool_choice = { type: 'auto' };
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Claude] ${res.status}:`, errText.substring(0, 500));

      // 429 Rate limit → 대기 후 1회 재시도
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after') || '5');
        console.log(`[Claude] Rate limited, waiting ${retryAfter}s...`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));

        const retryRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: this.getHeaders(),
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
    // assistant 응답은 항상 string content
    return typeof result.message.content === 'string' ? result.message.content : '';
  }
}

export const miniMaxClient = new MiniMaxClient();
