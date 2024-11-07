import express, { response } from 'express';
import { OpenAIService } from './OpenAIService';
import type OpenAI from 'openai';
import { createSystemPrompt, createUserPrompt, getAuth, postAnswer } from './helpers';
import { answeringPrompt } from './pompts';

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
    const auth = await getAuth();
    const question = auth.text;
    const msgId = auth.msgID;
    console.log('Question:', question, 'msgId:', msgId);

    const assistantAnswer = await getAnswer(question);
    const responseWebsite = await postAnswer(assistantAnswer, msgId);
    const flag = responseWebsite.text;
    res.json(flag);
  } catch (error) {
    console.error('Error in OpenAI completion:', JSON.stringify(error));
    res.status(500).json({ error: 'An error occurred while processing your request' });
  }
});

async function getAnswer(question: string) {
  const assistantAnswer = await openaiService.completion([
    createSystemPrompt(answeringPrompt),
    createUserPrompt(question)
  ], "gpt-4o-mini", false) as OpenAI.Chat.Completions.ChatCompletion;

  if (!assistantAnswer.choices[0].message.content) {
    throw new Error('Failed to fetch the answer');
  }
  const answer = assistantAnswer.choices[0].message.content;
  console.log('Answer:', answer);
  return answer;
}
