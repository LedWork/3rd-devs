import OpenAI, { toFile } from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import fs from 'fs/promises';
import { logger } from "../common/logger";
import { prompt as analyzeImagePrompt } from "./prompts/analyze_image";
import { prompt as identifyWomanPrompt } from "./prompts/identify_woman";

export class OpenAIService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI();
  }

  async completion(
    messages: ChatCompletionMessageParam[],
    model: string = "gpt-4o-mini",
    stream: boolean = false,
    jsonMode: boolean = false,
    maxTokens: number = 4096
  ): Promise<OpenAI.Chat.Completions.ChatCompletion | AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
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

  async getDescription(imagePath: string): Promise<string> {
    try {
      logger.info(`Getting description for image: ${imagePath}`);
      const image = await fs.readFile(imagePath);
      const base64Image = image.toString('base64');

      const response = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: identifyWomanPrompt()
          },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
            ],
          },
        ],
      });

      return response.choices[0].message.content || "{ action: 'NONE' }";
    } catch (error) {
      logger.error(`Error processing image ${imagePath}:`, error);
      throw error;
    }
  }

  async processImage(imagePath: string): Promise<string> {
    try {
      logger.info(`Processing image: ${imagePath}`);
      const image = await fs.readFile(imagePath);
      const base64Image = image.toString('base64');

      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: analyzeImagePrompt()
          },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
            ],
          },
        ],
      });

      return response.choices[0].message.content || "{ action: 'NONE' }";
    } catch (error) {
      logger.error(`Error processing image ${imagePath}:`, error);
      throw error;
    }
  }
}