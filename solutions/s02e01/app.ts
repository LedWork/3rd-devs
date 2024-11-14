import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { OpenAIService } from './OpenAIService';
import { AssistantService } from './AssistantService';
import { LangfuseService } from './LangfuseService';
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { FireCrawl } from './FireCrawl';

const app = express();
const port = 3000;

app.use(express.json());
app.use(cors({
  methods: ['GET', 'POST'],
  credentials: true,
}));

const langfuseService = new LangfuseService();
const openaiService = new OpenAIService();
const assistantService = new AssistantService(openaiService, langfuseService);
const fireCrawl = new FireCrawl();

app.post('/api/chat', async (req, res) => {
  let { messages, conversation_id = uuidv4() } = req.body;

  const transcriptions = await getTranscriptions('./tmp');
  let transcriptionsText = '';
  transcriptions.forEach((transcription, fileName) => {
    transcriptionsText += `Interview from file ${fileName}:\n${transcription}\n\n`;
  });

  const systemMessage: ChatCompletionMessageParam = {
    role: 'system',
    content: `You are a professional interview analyst. 
First, provide an initial answer to user's question based on the transcriptions and existing knowledge.
Then, suggest up to 3 specific search queries that could help verify or expand your answer.
The interrogated people might contradict each other, so you should search for multiple perspectives.
Some people might not have direct information, but they might know someone who does.
Some people might respond in unusual way.
The interview is in Polish.

Here are the interview transcriptions:
${transcriptionsText}

Format your response as:
<thinking>Your thought process here</thinking>
<initial_answer>Your initial answer here</initial_answer>
<search_queries>
1. First search query
2. Second search query
3. Third search query
</search_queries>`,
  };

  const trace = langfuseService.createTrace({
    id: uuidv4(),
    name: (messages.at(-1)?.content || '').slice(0, 45),
    sessionId: conversation_id
  });

  try {
    // Get initial answer with search queries
    const initialResponse = await assistantService.answer({ messages: [systemMessage, ...messages] }, trace);
    const initialMessage = initialResponse.choices[0].message;

    // Extract search queries and perform searches
    const searchQueriesMatch = initialMessage.content?.match(/<search_queries>([\s\S]*?)<\/search_queries>/);
    const searchQueries = searchQueriesMatch?.[1]
      .split('\n')
      .filter(line => line.trim())
      .map(line => line.replace(/^\d+\.\s*/, '')) ?? [];

    // Perform web searches
    const searchResults = await Promise.all(
      searchQueries.map(async query => {
        const results = await fireCrawl.search(query);
        return `Search for "${query}":\n${results.join('\n')}`;
      })
    );

    // Get final answer with search results
    const finalSystemMessage: ChatCompletionMessageParam = {
      role: 'system',
      content: `You are a professional interview analyst. 
Review your initial answer and the web search results to provide a final, refined answer.
Here are the web search results:
${searchResults.join('\n\n')}

Add your thought process in the <thinking> tag.
Format your final answer as short as possible (one word preferred) in the following tags:
<final_answer>Tutaj Twoja odpowiedź jednym słowem</final_answer>
Provide the answer in the language of the interview.
You are allowed to use external sources of information to get the answers.`,
    };

    const finalResponse = await assistantService.answer({
      messages: [
        finalSystemMessage,
        { role: 'assistant', content: initialMessage.content },
      ]
    }, trace);

    await langfuseService.finalizeTrace(trace, messages, finalResponse.choices[0].message);
    await langfuseService.flushAsync();
    
    return res.json({ 
      ...finalResponse, 
      conversation_id,
      initial_response: initialResponse 
    });
  } catch (error) {
    await langfuseService.finalizeTrace(trace, req.body, { error: 'An error occurred while processing your request' });
    console.error('Error in chat processing:', error);
    res.status(500).json({ error: 'An error occurred while processing your request' });
  }
});

app.listen(port, () => console.log(`Server running at http://localhost:${port}`));

process.on('SIGINT', async () => {
  await langfuseService.shutdownAsync();
  process.exit(0);
});

async function getTranscriptions(directoryPath: string): Promise<Map<string, string>> {
  // Try to get transcriptions from cache first
  const cacheFile = path.join(directoryPath, 'transcriptions-cache.json');
  
  try {
    if (fs.existsSync(cacheFile)) {
      const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      console.log('Cache hit.');
      return new Map(Object.entries(cache));
    }
  } catch (error) {
    console.error('Error reading cache:', error);
  }

  // If cache doesn't exist or is invalid, perform transcription
  console.log('Cache miss. Performing transcription...');
  const transcriptions = await transcribeDirectory(directoryPath);
  
  // Save to cache
  try {
    console.log('Saving to cache...');
    fs.writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(transcriptions)));
  } catch (error) {
    console.error('Error writing cache:', error);
  }

  return transcriptions;
}

async function transcribeDirectory(directoryPath: string): Promise<Map<string, string>> {
  const openaiService = new OpenAIService();
  const transcriptions = new Map<string, string>();

  try {
    const files = fs.readdirSync(directoryPath);
    const audioFiles = files.filter(file => path.extname(file).toLowerCase() === '.m4a');

    for (const fileName of audioFiles) {
      const filePath = path.join(directoryPath, fileName);

      try {
        const fileBuffer = fs.readFileSync(filePath);
        const transcription = await openaiService.transcribeGroq(fileBuffer);
        transcriptions.set(fileName, transcription);
        console.log(`Successfully transcribed: ${fileName}`);
      } catch (error) {
        console.error(`Error transcribing ${fileName}:`, error);
        transcriptions.set(fileName, `Error: Failed to transcribe file`);
      }
    }

  } catch (error) {
    console.error('Error reading directory:', error);
    throw new Error('Failed to process directory');
  }

  return transcriptions;
}

