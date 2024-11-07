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

export async function getAuth() {
  try {
    const response = await fetch('https://xyz.ag3nts.org/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: "READY",
        msgID: "0"
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const responseData = await response.json();
    console.log('Response:', responseData);
    return responseData;
  } catch (error) {
    throw new Error('Failed to fetch website content');
  }
}
;

export async function postAnswer(assistantAnswer: string, msgId: string) {
  try {
    const response = await fetch('https://xyz.ag3nts.org/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: assistantAnswer,
        msgID: msgId
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const responseData = await response.json();
    console.log('Response:', responseData);
    return responseData;
  } catch (error) {
    throw new Error('Failed to post answer');
  }
}
;
