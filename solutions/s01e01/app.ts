import express, { response } from 'express';
import { OpenAIService } from './OpenAIService';
import type OpenAI from 'openai';
import { createSystemPrompt, createUserPrompt, getWebsite, postFormWithAnswer } from './helpers';
import { answeringPrompt, extractQuestionPrompt, flagPrompt } from './pompts';

/*
Start Express server
*/
const app = express();
const port = 3000;
app.use(express.json());
app.listen(port, () => console.log(`Server running at http://localhost:${port}. Listening for POST /api/chat requests`));

const openaiService = new OpenAIService();

// Chat endpoint POST /api/chat
app.post('/api/chat', async (_req, res) => {

  try {
    const website = await getWebsite();

    const assistantResponse = await getWebsiteQuestion(website);
    const assistantAnswer = await getAnswer(assistantResponse);
    const responseWebsite = await postFormWithAnswer(assistantAnswer);
    const flag = await getFlag(responseWebsite);
    // console.log('FLAG:', flag);
    res.json(flag);
  } catch (error) {
    console.error('Error in OpenAI completion:', JSON.stringify(error));
    res.status(500).json({ error: 'An error occurred while processing your request' });
  }
});

async function getFlag(responseWebsite: string) {
const assistantFlag = await openaiService.completion([
    createSystemPrompt(flagPrompt),
    createUserPrompt(responseWebsite)
  ], "gpt-4o-mini", false) as OpenAI.Chat.Completions.ChatCompletion;

  if (!assistantFlag.choices[0].message.content) {
    throw new Error('Failed to fetch the flag');
  }

  const flag = assistantFlag.choices[0].message.content;
  return flag;
}

async function getAnswer(assistantResponse: string) {
  const assistantAnswer = await openaiService.completion([
    createSystemPrompt(answeringPrompt),
    createUserPrompt(assistantResponse)
  ], "gpt-4o-mini", false) as OpenAI.Chat.Completions.ChatCompletion;

  if (!assistantAnswer.choices[0].message.content) {
    throw new Error('Failed to fetch the answer');
  }
  const answer = assistantAnswer.choices[0].message.content;
  console.log('Answer:', answer);
  return answer;
}

async function getWebsiteQuestion(website: string) {
  const assistantResponse = await openaiService.completion([
    createSystemPrompt(extractQuestionPrompt),
    createUserPrompt(website)
  ], "gpt-4o-mini", false) as OpenAI.Chat.Completions.ChatCompletion;

  if (!assistantResponse.choices[0].message.content) {
    throw new Error('Failed to fetch the question');
  }
  const question = assistantResponse.choices[0].message.content;
  console.log('Question:', question);
  return question;
}

