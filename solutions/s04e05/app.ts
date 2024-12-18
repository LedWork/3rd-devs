import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { IAssistantTools, IDoc } from './types/types';
import { SearchService } from './services/SearchService';
import { DatabaseService } from "./services/DatabaseService";
import { OpenAIService } from "./services/OpenAIService";
import { VectorService } from "./services/VectorService";
import { DocumentService } from './services/DocumentService';
import { TextService } from './services/TextService';
import { FileService } from './services/FileService';
import { WebSearchService } from './services/WebSearch';
import { AssistantService } from './services/AssistantService';
import { logger } from '../common/logger';
import { existsSync } from 'fs';
import fs from 'fs';
import { LangfuseService } from './services/LangfuseService';
import { prompt as correctPrompt } from './prompts/documents/correctPolishText';
import { prompt as answerPrompt } from './prompts/documents/answerPrompt';
import type { ChatCompletionMessageParam, ChatCompletion } from "openai/resources/chat/completions";
const { exec } = require('child_process');
const fileService = new FileService(path.join(process.cwd(), 'solutions', 's04e05', 'storage'));
const textService = new TextService();
const openaiService = new OpenAIService();
const vectorService = new VectorService(openaiService);
const searchService = new SearchService(String(process.env.ALGOLIA_APP_ID), String(process.env.ALGOLIA_API_KEY));
const databaseService = new DatabaseService(path.join(__dirname, 'database.db'), searchService, vectorService);
const documentService = new DocumentService(openaiService, databaseService, textService);
const langfuseService = new LangfuseService();

const trace = langfuseService.createTrace({ id: uuidv4(), name: 's04e05', sessionId: uuidv4() });

async function processPdf(pdfPath: string) {
  const markdownPath = `${pdfPath}.md`;
  if (fs.existsSync(markdownPath)) {
    logger.info('Markdown file already exists');
    return;
  }
  logger.info('Processing PDF file');

  const content = await fileService.readPdfFile(pdfPath);
  fs.writeFileSync(`${pdfPath}.md`, content);
  logger.info('Markdown file saved');

  if (!fs.existsSync(`${pdfPath}.md`)) {
    throw new Error('Failed to save markdown file');
  }
}

async function ocrPages() {
  try {
    const imageFiles = ['page_1.jpg', 'page_2.jpg', 'page_3.jpg'];
    const results = await openaiService.ocrImages(imageFiles);
    
    // Combine all descriptions and save to a file
    const combinedText = results
      .map(result => result.description)
      .join('\n\n---\n\n');
    
    const outputPath = path.join(__dirname, 'ocr_output.md');
    fs.writeFileSync(outputPath, combinedText);
    
    logger.info('OCR processing completed successfully');
    return { success: true, outputPath };
    
  } catch (error: any) {
    logger.error('Error in OCR processing:', error);
    throw error;
  }
}

async function correctPolishText(markdownPath: string) {
  try {
    logger.info('Correcting Polish text');
    const content = fs.readFileSync(markdownPath, 'utf-8');
    
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: correctPrompt()
      },
      {
        role: 'user',
        content: content
      }
    ];

    const span = langfuseService.createSpan(trace, 'correctPolishText', messages);
    const correctedTextResponse = await openaiService.completion({
      model: 'gpt-4o-mini',
      messages: messages
    });
    langfuseService.finalizeSpan(span, 'correctPolishText', messages, correctedTextResponse as ChatCompletion);

    const correctedText = correctedTextResponse.choices[0].message.content?.match(/<answer>(.*?)<\/answer>/)?.[1];
    const correctedPath = markdownPath.replace('.md', '_corrected.md');
    fs.writeFileSync(correctedPath, correctedText);
    logger.info('Corrected text saved to:', correctedPath);
    
    return correctedPath;
  } catch (error: any) {
    logger.error('Error correcting Polish text:', error);
    throw error;
  }
}

interface CentralaResponse {
  code: number;
  message: string;
  hint?: string;
  debug?: string;
}

async function findAnswers(questions: Record<string, string>, correctedContent: string, previousAnswer?: string, hint?: string, debug?: string): Promise<Record<string, string>> {
  const answers: Record<string, string> = {};
  
  for (const [questionId, question] of Object.entries(questions)) {
    try {
      const messages: ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content: answerPrompt(correctedContent)
        },
        {
          role: 'user',
          content: `${question}\nPrzeanalizuj dokładnie wszystkie daty i wydarzenia w tekście. Odpowiedź musi być precyzyjna i oparta na wszystkich dostępnych faktach.`
        }
      ];

      if (hint && debug) {
        messages.push({
          role: 'assistant',
          content: `<answer>${previousAnswer}</answer>`
        });
        messages.push({
          role: 'user',
          content: `Poprzednia odpowiedź (${debug}) była nieprawidłowa. Wskazówka: ${hint}. Przeanalizuj ponownie tekst, zwracając szczególną uwagę na chronologię wydarzeń i daty.`
        });
      }

      const span = langfuseService.createSpan(trace, `findAnswers-${questionId}`, messages);
      const answersResponse = await openaiService.completion({
        model: 'gpt-4o', 
        messages: messages,
        jsonMode: true
      });
      langfuseService.finalizeSpan(span, `findAnswers-${questionId}`, messages, answersResponse as ChatCompletion);

      const { answer, thinking } = JSON.parse(answersResponse.choices[0].message.content || "{}");
      logger.info(`Answer for question ${questionId}:`, thinking, answer);
      answers[questionId] = answer;
    } catch (error) {
      logger.error(`Error processing question ${questionId}:`, error);
      answers[questionId] = ''; // Provide a default empty answer instead of failing
    }
  }

  return answers;
}

async function submitAnswers(apiKey: string, answers: Record<string, string>): Promise<CentralaResponse> {
  logger.info('Submitting answers: ', answers);
  const response = await fetch('https://centrala.ag3nts.org/report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task: 'notes',
      apikey: apiKey,
      answer: answers
    })
  });

  return await response.json();
}

// TODO:
// - obrazki, ktore sa w pdfie, nie sa odczytywane
// - dodac tekst do bazy wektorowej wraz z contextem oraz obrazkami
// - przetestowac llamaindex

async function main() {
  const apiKey = process.env.AI_DEVS_API_KEY;
  if (!apiKey) {
    throw new Error('AI_DEVS_API_KEY not found in environment variables');
  }

  const pdfPath = path.join(__dirname, 'notatnik-rafala.pdf');
  // await processPdf(pdfPath);
  // await ocrPages();
  // await correctPolishText(`${pdfPath}.md`);
  const correctedPath = path.join(__dirname, 'notatnik-rafala.pdf_corrected.md');
  const correctedContent = fs.readFileSync(correctedPath, 'utf-8');
  const notesPath = path.join(__dirname, 'notes.json');
  const notesContent = fs.readFileSync(notesPath, 'utf-8');
  const notes = JSON.parse(notesContent);
  logger.info('Questions:', notes);

  let answers = await findAnswers(notes, correctedContent);
  let result: CentralaResponse;
  
  let retries = 0;
  while (retries < 1) {
    retries++;
    result = await submitAnswers(apiKey, answers);
    logger.info('Submission result:', result);

    if (result.code === 200) {
      logger.info('All answers are correct!');
      break;
    }

    // Extract question ID from error message
    const questionIdMatch = result.message.match(/Answer for question (\d+)/);
    if (!questionIdMatch) {
      logger.error('Could not parse question ID from error message');
      break;
    }

    const questionId = questionIdMatch[1].padStart(2, '0');
    logger.info(`Retrying question ${questionId} with hint: ${result.hint}`);

    // Get new answer only for the incorrect question
    const partialAnswers = await findAnswers(
      { [questionId]: notes[questionId] },
      correctedContent,
      answers[questionId],
      result.hint,
      result.debug
    );

    // Update only the incorrect answer while keeping the rest
    answers = {
      ...answers,
      [questionId]: partialAnswers[questionId]
    };
  }
}

main().catch(error => {
  logger.error('Application error:', error);
  process.exit(1);
}).finally(() => {
  langfuseService.flushAsync();
});