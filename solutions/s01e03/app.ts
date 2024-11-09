import express from 'express';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import type { ChatCompletionMessageParam, ChatCompletion } from "openai/resources/chat/completions";
import { OpenAIService } from './OpenAIService';
import { LangfuseTraceClient } from 'langfuse';
import { LangfuseService } from './LangfuseService';
import { systemPrompt } from './pompts';

/*
Start Express server
*/
const app = express();
const port = 3000;
app.use(express.json());
app.listen(port, () => console.log(`Server running at http://localhost:${port}. Listening for POST /api/chat requests`));

const openAIService = new OpenAIService();
const langfuseService = new LangfuseService();

app.post('/api/chat', async (req, res) => {
  const { messages = [], model = "gpt-4o-mini" }: { messages: ChatCompletionMessageParam[], model?: string } = req.body;

  const trace = langfuseService.createTrace({
    id: uuidv4(),
    name: "s01e03",
    sessionId: uuidv4()
  });

  //read content from data.json
  const data = await fs.readFile('./poligon/data.json', 'utf8');
  const jsonData = JSON.parse(data);
  const originalTestData = jsonData['test-data'];

  // Compress the test data before processing
  const compressedData = compressTestData(jsonData);
  // Combine regular tests and special tests
  const allTests = [...compressedData.tests, ...compressedData.special];
  const systemMessage: ChatCompletionMessageParam = { role: "system", content: systemPrompt };

  const baseTokenCount = await openAIService.countTokens([systemMessage], model);
  const maxTokens = await openAIService.getModelMaxTokens(model);
  // const maxTokens = 400;
  console.log(`Max tokens for model ${model || 'gpt-4o'}: ${maxTokens}`);

  let tokenCount = 0;
  let questions = [];
  let allAnswers: any[] = [];
  let totalPushedQuestions = 0;
  let totalTokens = 0;
  for (const question of allTests) {
    console.log(`Processing question: ${question}`);
    const newTokenCount = await openAIService.countTokens([createUserMessage(question)], model);

    if (2 * (tokenCount + newTokenCount) + baseTokenCount < maxTokens - 100) {
      questions.push(question);
      tokenCount += newTokenCount;
      totalPushedQuestions++;
      totalTokens += newTokenCount;
    } else {
      console.log("Total pushed questions up to this moment: ", totalPushedQuestions);
      console.log("Total tokens up to this moment: ", tokenCount);
      allAnswers = await getAnswers(systemMessage, questions, model, allAnswers, trace);
      tokenCount = 0;
      questions = [];
      // loop only twice
      // if (totalPushedQuestions >= 2) {
      //   break;
      // }
      questions.push(question);
      tokenCount += newTokenCount;
      totalPushedQuestions++;
      totalTokens += newTokenCount;
    }
  }

  console.log("Total pushed questions: ", totalPushedQuestions);
  console.log("Total tokens: ", totalTokens);
  
  if (questions.length > 0) {
    allAnswers = await getAnswers(systemMessage, questions, model, allAnswers, trace);
  }
  
  console.log("All answers: ", allAnswers);
  await langfuseService.finalizeTrace(trace, originalTestData, allAnswers);

  // Before writing results back to file, uncompress the data
  const dataWithAnswers = uncompressTestData(
    {
      tests: allAnswers.slice(0, compressedData.tests.length),
      special: allAnswers.slice(compressedData.tests.length).map(answer => {
        console.log("Answer: ", answer);
        const [q, a] = answer.split('=');
        return { q, a };
      })
    },
    jsonData
  );
  await fs.writeFile('./poligon/data-answers.json', JSON.stringify(dataWithAnswers, null, 2));

  res.json("DONE");
});

function createUserMessage(question: string): ChatCompletionMessageParam {
  // For compressed format, we can send the string directly
  return { role: "user", content: question };
}

async function getAnswers(
  systemMessage: ChatCompletionMessageParam,
  questions: string[],
  model: string,
  allAnswers: string[],
  trace: LangfuseTraceClient
) {
  console.log("Getting answers for questions.");
  const userMessage = createUserMessage(questions.join('\n'));
  const messages = [systemMessage, userMessage];
  const mainSpan = langfuseService.createSpan(trace, "Main Completion", messages);
  const { fullResponse: answer, usage } = await openAIService.continuousCompletion({
    messages,
    model,
    maxTokens: await openAIService.getModelMaxTokens(model)
  });

  const answerChatCompletion: ChatCompletion = {
    choices: [{ message: { role: "assistant", content: answer } }],
    usage: usage,
    model: model
  };
  langfuseService.finalizeSpan(mainSpan, "Main Completion", messages, answerChatCompletion);

  try {
    allAnswers = allAnswers.concat(
      answer.split('\n').map(line => line.trim())
    );
  } catch (error) {
    console.error(`Error parsing answer: ${answer}`, error);
  }
  return allAnswers;
}

interface TestCase {
  question: string;
  answer: number;
  test?: {
    q: string;
    a: string;
  };
}

interface OriginalJson {
  apikey: string;
  description: string;
  copyright: string;
  "test-data": TestCase[];
}

interface CompressedData {
  tests: string[];      // Format: "question=answer"
  special: string[];    // Format: "q=a" for special tests
  metadata?: {
    original_count: number;
    compressed_count: number;
    special_cases: number;
  };
}

function compressTestData(jsonData: OriginalJson): CompressedData {
  const uniqueTests: Map<string, number> = new Map();
  const specialTests: string[] = [];
  
  // Process each test entry
  for (const entry of jsonData["test-data"]) {
    const { question, answer, test } = entry;
    
    // Store special test cases in compressed format
    if (test) {
      specialTests.push(`${test.q}=${test.a}`);
      continue;
    }
    
    // Store only unique questions
    if (!uniqueTests.has(question)) {
      uniqueTests.set(question, answer);
    }
  }
  
  // Convert to compact format: "question=answer"
  const compressed = Array.from(uniqueTests.entries()).map(
    ([q, a]) => `${q}=${a}`
  );
  
  return {
    tests: compressed,
    special: specialTests,
    metadata: {
      original_count: jsonData["test-data"].length,
      compressed_count: compressed.length,
      special_cases: specialTests.length
    }
  };
}

/**
* Unparses compressed data back to original JSON format
*/
function uncompressTestData(
  compressedData: CompressedData,
  originalJson: OriginalJson
): OriginalJson {
  // Create lookup table from compressed data
  const corrections = new Map<string, number>();
  for (const test of compressedData.tests) {
    const [question, answer] = test.split('=');
    corrections.set(question, parseInt(answer, 10));
  }

  // Create lookup for special tests
  const specialTests = new Map(
    compressedData.special.map(test => [test.q, test.a])
  );

  // Create deep copy of original data
  const updatedData: OriginalJson = {
    ...originalJson,
    "test-data": originalJson["test-data"].map(entry => ({ ...entry }))
  };

  // Update original data with corrections
  for (const entry of updatedData["test-data"]) {
    // Update answer if correction exists
    if (corrections.has(entry.question)) {
      entry.answer = corrections.get(entry.question)!;
    }

    // Update special test case if exists
    if (entry.test && specialTests.has(entry.test.q)) {
      entry.test.a = specialTests.get(entry.test.q)!;
    }
  }

  return updatedData;
}
