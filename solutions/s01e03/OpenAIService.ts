import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { createByModelName } from '@microsoft/tiktokenizer';

export class OpenAIService {
  private openai: OpenAI;
  private tokenizers: Map<string, Awaited<ReturnType<typeof createByModelName>>> = new Map();
  private readonly IM_START = "<|im_start|>";
  private readonly IM_END = "<|im_end|>";
  private readonly IM_SEP = "<|im_sep|>";

  constructor() {
    this.openai = new OpenAI();
  }

  async getModelMaxTokens(model: string): Promise<number> {
    // Default max tokens for common models
    const MODEL_MAX_TOKENS: { [key: string]: number } = {
      'gpt-4': 8192,
      'gpt-4-32k': 32768,
      'gpt-3.5-turbo': 4096,
      'gpt-3.5-turbo-16k': 16384,
      'gpt-4-turbo-preview': 128000,
      'gpt-4-1106-preview': 128000,
      'gpt-4o': 128000,
      'gpt-4o-mini': 16384
    };

    // If model is in our known list, return that value
    if (model in MODEL_MAX_TOKENS) {
      return MODEL_MAX_TOKENS[model];
    }

    console.warn(`Could not determine max tokens for model ${model}, using default encoding`);
    throw new Error(`Could not determine max tokens for model ${model}`);
  }

  private async getTokenizer(modelName: string) {
    if (!this.tokenizers.has(modelName)) {
      const specialTokens: ReadonlyMap<string, number> = new Map([
        [this.IM_START, 100264],
        [this.IM_END, 100265],
        [this.IM_SEP, 100266],
      ]);
      const tokenizer = await createByModelName(modelName, specialTokens);
      this.tokenizers.set(modelName, tokenizer);
    }
    return this.tokenizers.get(modelName)!;
  }

  async countTokens(messages: ChatCompletionMessageParam[], model: string = 'gpt-4o'): Promise<number> {
    const tokenizer = await this.getTokenizer(model);

    let formattedContent = '';
    messages.forEach((message) => {
      formattedContent += `${this.IM_START}${message.role}${this.IM_SEP}${message.content || ''}${this.IM_END}`;
    });
    formattedContent += `${this.IM_START}assistant${this.IM_SEP}`;

    const tokens = tokenizer.encode(formattedContent, [this.IM_START, this.IM_END, this.IM_SEP]);
    return tokens.length;
  }

  async completion(config: {
    messages: ChatCompletionMessageParam[],
    model?: string,
    stream?: boolean,
    jsonMode?: boolean,
    maxTokens?: number
  }): Promise<OpenAI.Chat.Completions.ChatCompletion | AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
    const { messages, model = "gpt-4", stream = false, jsonMode = false, maxTokens = 1024 } = config;
    try {
      const chatCompletion = await this.openai.chat.completions.create({
        messages,
        model,
        stream,
        max_tokens: maxTokens,
        response_format: jsonMode ? { type: "json_object" } : { type: "text" }
      });

      if (stream) {
        return chatCompletion as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
      } else {
        return chatCompletion as OpenAI.Chat.Completions.ChatCompletion;
      }
    } catch (error) {
      console.error("Error in OpenAI completion:", error);
      throw error;
    }
  }

  async continuousCompletion(config: {
    messages: ChatCompletionMessageParam[],
    model?: string,
    maxTokens?: number
  }): Promise<{ fullResponse: string, usage: { prompt_tokens: number, completion_tokens: number, total_tokens: number } }> {
    let { messages, model = "gpt-4o", maxTokens = 1024 } = config;
    let fullResponse = "";
    let isCompleted = false;
    let usagePromptTokens = 0;
    let usageCompletionTokens = 0;
    let usageTotalTokens = 0;
    while (!isCompleted) {
      const completion = await this.completion({ messages, model, maxTokens }) as OpenAI.Chat.Completions.ChatCompletion;

      const choice = completion.choices[0];
      usagePromptTokens += completion.usage?.prompt_tokens || 0;
      usageCompletionTokens += completion.usage?.completion_tokens || 0;
      usageTotalTokens += completion.usage?.total_tokens || 0;
      fullResponse += choice.message.content || "";

      if (choice.finish_reason !== "length") {
        isCompleted = true;
      } else {
        console.log("Continuing completion...");
        messages = [
          ...messages,
          { role: "assistant", content: choice.message.content },
          { role: "user", content: "[system: Please continue your response to the user's question and finish when you're done from the very next character you were about to write, because you didn't finish your response last time. At the end, your response will be concatenated with the last completion.]" }
        ];
      }
    }

    return { 
      fullResponse, 
      usage: {
        prompt_tokens: usagePromptTokens,
        completion_tokens: usageCompletionTokens,
        total_tokens: usageTotalTokens
      }
    };
  }
}
