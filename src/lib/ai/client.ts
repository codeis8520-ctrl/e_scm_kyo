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

export interface MiniMaxChatResponse {
  id: string;
  choices: {
    index: number;
    message: MiniMaxMessage;
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** Groq API 호출 래퍼 — tool_use_failed 시 도구 없이 자동 재시도 */
async function callGroq(
  baseUrl: string,
  headers: HeadersInit,
  body: any,
  useTools: boolean,
): Promise<MiniMaxChatResponse> {
  const reqBody = { ...body };
  if (!useTools) {
    delete reqBody.tools;
    delete reqBody.tool_choice;
  }

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(reqBody),
  });

  if (!res.ok) {
    const errText = await res.text();

    // tool_use_failed → 도구 없이 깨끗하게 재시도
    if (res.status === 400 && errText.includes('tool_use_failed') && useTools) {
      return callGroq(baseUrl, headers, body, false);
    }

    throw new Error(`Groq API 오류: ${res.status} - ${errText.substring(0, 300)}`);
  }

  return res.json();
}

export class MiniMaxClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor() {
    this.apiKey = process.env.MINIMAX_API_KEY || '';
    this.baseUrl = process.env.MINIMAX_BASE_URL || 'https://api.groq.com/openai';
    this.model = process.env.MINIMAX_MODEL || 'llama-3.3-70b-versatile';
  }

  private getHeaders(): HeadersInit {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  async chatWithTools(messages: MiniMaxMessage[], tools?: MiniMaxTool[]): Promise<{
    message: MiniMaxMessage;
    finish_reason: string;
  }> {
    if (!this.apiKey) {
      throw new Error('AI API 키가 설정되지 않았습니다.');
    }

    // 도구 정의에 required 누락 시 빈 배열 보장 (Llama 호환)
    const normalizedTools = tools?.map(t => ({
      ...t,
      function: {
        ...t.function,
        parameters: {
          ...t.function.parameters,
          required: t.function.parameters.required || [],
        },
      },
    }));

    const body: any = {
      model: this.model,
      messages: messages.map(m => {
        const msg: any = { role: m.role, content: m.content ?? '' };
        if (m.tool_calls) msg.tool_calls = m.tool_calls;
        if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
        if (m.name) msg.name = m.name;
        return msg;
      }),
      temperature: 0.3,
      max_tokens: 2048,
    };

    const useTools = !!(normalizedTools && normalizedTools.length > 0);
    if (useTools) {
      body.tools = normalizedTools;
      body.tool_choice = 'auto';
    }

    // 1차 시도
    let data: MiniMaxChatResponse;
    try {
      data = await callGroq(this.baseUrl, this.getHeaders(), body, useTools);
    } catch (err) {
      // 1회 재시도 (네트워크 일시 오류 등)
      data = await callGroq(this.baseUrl, this.getHeaders(), body, useTools);
    }

    if (!data.choices || data.choices.length === 0) {
      throw new Error('AI 서비스 응답이 없습니다.');
    }

    return {
      message: data.choices[0].message,
      finish_reason: data.choices[0].finish_reason,
    };
  }

  async chat(messages: MiniMaxMessage[]): Promise<string> {
    const result = await this.chatWithTools(messages);
    return result.message.content;
  }
}

export const miniMaxClient = new MiniMaxClient();
