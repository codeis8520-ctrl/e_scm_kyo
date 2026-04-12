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

    const body: any = {
      model: this.model,
      messages: messages.map(m => {
        const msg: any = { role: m.role, content: m.content ?? '' };
        if (m.tool_calls) msg.tool_calls = m.tool_calls;
        if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
        if (m.name) msg.name = m.name;
        return msg;
      }),
      temperature: 0.1,
      max_tokens: 4096,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Groq tool_use_failed: Llama가 tool call 형식을 잘못 생성 → 도구 없이 재시도
      if (response.status === 400 && errorText.includes('tool_use_failed')) {
        const retryBody = { ...body };
        delete retryBody.tools;
        delete retryBody.tool_choice;
        // 사용자에게 직접 텍스트로 답변하도록 유도
        retryBody.messages = [
          ...retryBody.messages,
          { role: 'system', content: '도구 호출에 실패했습니다. 도구 없이 알고 있는 정보로 간결히 답변하세요.' },
        ];
        const retryRes = await fetch(`${this.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(retryBody),
        });
        if (retryRes.ok) {
          const retryData: MiniMaxChatResponse = await retryRes.json();
          if (retryData.choices?.length) {
            return { message: retryData.choices[0].message, finish_reason: retryData.choices[0].finish_reason };
          }
        }
      }
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    const data: MiniMaxChatResponse = await response.json();

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
