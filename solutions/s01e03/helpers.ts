import type OpenAI from "openai";
import type { Completions } from "openai/resources/chat/completions.mjs";
import type { Chat, ChatCompletion, ChatCompletionMessageParam } from "openai/resources/index.mjs";

export function createSystemPrompt(systemPrompt: string): ChatCompletionMessageParam {
  return {
    role: "system",
    content: systemPrompt
  };
}
;

export function createUserPrompt(messageBody: string): ChatCompletionMessageParam {
  return {
    role: "user",
    content: messageBody
  };
}
;

export async function getWebsite() {
  try {
    const response = await fetch('https://xyz.ag3nts.org');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const website = await response.text();
    // console.log('Website:', website);
    return website;
  } catch (error) {
    throw new Error('Failed to fetch website content');
  }
}
;

export async function postFormWithAnswer(assistantAnswer: string) {
  const url = "https://xyz.ag3nts.org/";
  const body = "username=tester&password=574e112a&answer=" + assistantAnswer;
  const headers = {
    "content-type": "application/x-www-form-urlencoded",
  };

  try {
    const response = await fetch(url, {
      headers,
      body,
      method: "POST"
    });

    if (!response.ok) {
      throw new Error(`POST form with answer HTTP error! status: ${response.status}`);
    }

    const responseText = await response.text();
    // console.log('Response text:', responseText);
    return responseText;
  } catch (error) {
    throw new Error('Failed to post form with answer');
  }
}
;
