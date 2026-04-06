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
    this.baseUrl = process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat';
    this.model = process.env.MINIMAX_MODEL || 'MiniMax-Text-01';
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
      throw new Error('MINIMAX_API_KEY is not set');
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

    const response = await fetch(`${this.baseUrl}/v1/text/chatcompletion_v2`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`MiniMax API error: ${response.status} - ${error}`);
    }

    const data: MiniMaxChatResponse = await response.json();

    if (!data.choices || data.choices.length === 0) {
      throw new Error('No response from MiniMax');
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
