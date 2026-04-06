import Anthropic from '@anthropic-ai/sdk';

export type AnthropicTool = Anthropic.Tool;
export type AnthropicMessage = Anthropic.MessageParam;
export type ContentBlock = Anthropic.ContentBlock;

export class ClaudeClient {
  private client: Anthropic;
  readonly model: string;

  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.model = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
  }

  async chat(
    system: string,
    messages: AnthropicMessage[],
    tools?: AnthropicTool[]
  ): Promise<{ content: ContentBlock[]; stop_reason: string }> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system,
      messages,
      tools: tools?.length ? tools : undefined,
    });
    return { content: response.content, stop_reason: response.stop_reason ?? 'end_turn' };
  }
}

export const claudeClient = new ClaudeClient();
