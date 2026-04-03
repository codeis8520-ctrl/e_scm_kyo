export interface MiniMaxMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface MiniMaxChatRequest {
  model: string;
  messages: MiniMaxMessage[];
  temperature?: number;
  max_tokens?: number;
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

  async chat(messages: MiniMaxMessage[]): Promise<string> {
    if (!this.apiKey) {
      throw new Error('MINIMAX_API_KEY is not set');
    }

    const response = await fetch(`${this.baseUrl}/v1/text/chatcompletion`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        model: this.model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        temperature: 0.3,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`MiniMax API error: ${response.status} - ${error}`);
    }

    const data: MiniMaxChatResponse = await response.json();
    
    if (!data.choices || data.choices.length === 0) {
      throw new Error('No response from MiniMax');
    }

    return data.choices[0].message.content;
  }
}

export const miniMaxClient = new MiniMaxClient();
