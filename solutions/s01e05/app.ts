import express from 'express';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import type { ChatCompletionMessageParam, ChatCompletion } from "openai/resources/chat/completions";
import { OpenAIService } from './OpenAIService';
import { LangfuseTraceClient } from 'langfuse';
import { LangfuseService } from './LangfuseService';
import { systemPrompt } from './prompts';

/*
Start Express server
*/
const app = express();
const port = 3000;
app.use(express.json());
app.listen(port, () => console.log(`Server running at http://localhost:${port}. Listening for POST /api/chat requests`));

const langfuseService = new LangfuseService();

app.post('/api/chat', async (req, res) => {
  const { apikey = "", model = "gpt-4o-mini" }: { apikey: string, model?: string } = req.body;

  const trace = langfuseService.createTrace({
    id: uuidv4(),
    name: "s01e05",
    sessionId: uuidv4()
  });

  const cenzura = await fetch(`https://centrala.ag3nts.org/data/${apikey}/cenzura.txt`);
  const textToCensor = await cenzura.text();
  console.log(`Text to censor:\n${textToCensor}`);

  const body = { model: "gemma:2b", prompt: `${systemPrompt} ${textToCensor}`, stream: false};
  const span = langfuseService.createSpan(trace, "ollama", body);
  
  const ollamaUrl = 'http://localhost:11434/api/generate';
  const ollamaResponse = await fetch(ollamaUrl, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  const ollamaData = await ollamaResponse.json();
  const ollamaResponseText = ollamaData.response;
  console.log(`Ollama response: ${ollamaResponseText}`);
  langfuseService.finalizeSpanString(span, "ollama", [body.prompt], ollamaResponseText);
  await langfuseService.finalizeTraceString(trace, [body.prompt], ollamaResponseText);

  const hasAnswerTag = ollamaResponseText.match(/<answer>(.*?)<\/answer>/);
  const answer = hasAnswerTag ? hasAnswerTag[1] : ollamaResponseText;
  console.log(`Answer:\n${answer}`);

  const reportBody = JSON.stringify({answer: answer, task: "CENZURA", "apikey": apikey});
  console.log(`Report body: ${reportBody}`);
  const reportResponse = await fetch(`https://centrala.ag3nts.org/report`, {
    method: 'POST',
    body: reportBody,
    headers: {
      "Content-Type": "application/json"
    }
  });

  const reportResponseJson = await reportResponse.json();
  console.log(`Report response: ${JSON.stringify(reportResponseJson)}`);
  res.json(reportResponseJson);
});

