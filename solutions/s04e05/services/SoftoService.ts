import { promises as fs } from 'fs';
import path from 'path';
import { WebSearchService } from './WebSearch';
import { OpenAIService } from './OpenAIService';
import { TextService } from './TextService';
import { FileService } from './FileService';
import { LangfuseService } from './LangfuseService';
import { v4 as uuidv4 } from 'uuid';
import type { ChatCompletion } from 'openai/resources/chat/completions.mjs';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.mjs';
import { logger } from '../../common/logger';
import { prompt } from '../prompts/softo/extractUrl';

interface Question {
    [key: string]: string;
}

interface PageCache {
    [url: string]: {
        content: string;
        links: string[];
    };
}

const langfuseService = new LangfuseService();

const trace = langfuseService.createTrace({
    id: uuidv4(),
    name: 'Softo Processing',
    sessionId: uuidv4()
});

export class SoftoService {
    private webSearchService: WebSearchService;
    private openAIService: OpenAIService;
    private fileService: FileService;
    private textService: TextService;
    private visitedUrls: Set<string> = new Set();
    private pageCache: PageCache = {};
    private baseUrl = 'https://softo.ag3nts.org';

    constructor() {
        this.webSearchService = new WebSearchService();
        this.openAIService = new OpenAIService();
        this.textService = new TextService();
        this.fileService = new FileService();
    }

    async fetchQuestions(apiKey: string): Promise<Question> {
        const url = `https://centrala.ag3nts.org/data/${apiKey}/softo.json`;
        const response = await fetch(url);
        const questions = await response.json();

        // Save questions to file
        const filePath = path.join(__dirname, '..', 'data', 'softo.json');
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(questions, null, 2));

        return questions;
    }

    async findAnswers(questions: Question): Promise<Question> {
        const answers: Question = {};

        // Start with the homepage
        await this.processPage(this.baseUrl);

        // Process each question
        for (const [id, question] of Object.entries(questions)) {
            logger.debug(`Processing question ${id}: ${question}`);
            const answer = await this.findAnswerWithRetries(question);
            answers[id] = answer ?? '';
        }

        return answers;
    }

    private async findAnswerWithRetries(question: string, maxRetries = 3): Promise<string | null> {
        let attempts = 0;
        let allLinks = this.getAllLinks();
        let previouslySearchedUrls = new Set<string>();

        while (attempts < maxRetries) {
            attempts++;
            logger.debug(`Attempt ${attempts} to find answer for question: ${question}`);

            // Get most relevant links from all available links
            const relevantLinks = await this.findMostRelevantLinks(allLinks, question);
            logger.debug(`Found ${relevantLinks.length} relevant links: ${relevantLinks}`);

            // Crawl any new relevant links we haven't visited yet
            for (const link of relevantLinks) {
                if (!this.pageCache[link]) {
                    await this.processPage(link);
                }
            }

            // Create content map for relevant links we haven't searched yet
            const newContentMap = relevantLinks
                .filter(url => this.pageCache[url] && !previouslySearchedUrls.has(url))
                .map(url => ({
                    url,
                    content: this.pageCache[url].content
                }));

            if (newContentMap.length > 0) {
                // Try to find answer in the new content
                const answer = await this.searchInCache(question, newContentMap);
                if (answer) {
                    return answer;
                }

                // Mark these URLs as searched
                newContentMap.forEach(({ url }) => previouslySearchedUrls.add(url));
            }

            // Update allLinks with any new links we've discovered
            allLinks = this.getAllLinks();
            logger.debug(`Updated link pool, now have ${allLinks.length} total links`);
        }

        return null;
    }

    private getAllLinks(): string[] {
        const links = new Set<string>();
        
        // Add all visited URLs
        this.visitedUrls.forEach(url => links.add(url));
        
        // Add all cached page links
        Object.values(this.pageCache).forEach(page => {
            page.links.forEach(link => links.add(link));
        });

        return Array.from(links);
    }

    private async processPage(url: string): Promise<void> {
        if (this.visitedUrls.has(url)) {
            logger.debug(`Already visited ${url}`);
            return;
        }

        logger.debug(`Processing page: ${url}`);

        const crawledContentArray = await this.webSearchService.scrapeUrls([url], '');
        const flattenedContentArray = crawledContentArray.flat();
        logger.debug(`Crawled content: ${flattenedContentArray.length} items`);

        if (flattenedContentArray.length > 0) {
            this.visitedUrls.add(url);
            flattenedContentArray.forEach(item => {
                this.visitedUrls.add(item.url);
                this.pageCache[item.url] = {
                    content: item.content,
                    links: item.links
                };
            });
        }
    }

    private async searchInCache(question: string, contentMap: { url: string; content: string }[]): Promise<string | null> {
        if (contentMap.length === 0) {
            return null;
        }

        const messages: ChatCompletionMessageParam[] = [
            {
                role: 'system',
                content: `You are an AI assistant helping to find answers in cached web pages.
                    Review the following page contents and determine if any contains the answer to the question.

                    The question is: ${question}

                    ALWAYS return _thinking tags in your response.
                    Format your response as a JSON object with a _thinking field and an answer field.
                    The _thinking field should contain your reasoning for selecting the answer.
                    The answer field should contain the answer to the question.
                    If not found, respond with answer field empty.`
            },
            {
                role: 'user',
                content: contentMap
                    .map(({ url, content }) => `URL: ${url}\nContent: ${content}`)
                    .join('\n\n')
            }
        ];

        const span = langfuseService.createSpan(trace, 'searchInCache', messages);
        const completion = await this.openAIService.completion({
            messages: messages,
            model: 'gpt-4o-mini',
            jsonMode: true
        });
        langfuseService.finalizeSpan(span, 'searchInCache', messages, completion as ChatCompletion);

        if (!('choices' in completion)) {
            return null;
        }

        const { answer } = JSON.parse(
            completion.choices[0].message.content || ""
        );

        if (!answer) {
            return null;
        }

        return answer;
    }

    private async findMostRelevantLinks(linksToEvaluate: string[], question: string): Promise<string[]> {
        if (linksToEvaluate.length === 0) {
            logger.debug('No links to evaluate');
            return [];
        }

        const messages: ChatCompletionMessageParam[] = [
            {
                role: 'system',
                content: prompt({ question })
            },
            {
                role: 'user',
                content: linksToEvaluate.join('\n')
            }
        ];

        const span = langfuseService.createSpan(trace, 'findMostRelevantLinks', messages);
        const completion = await this.openAIService.completion({
            messages: messages,
            model: 'gpt-4o-mini',
            jsonMode: true
        }) as ChatCompletion;
        langfuseService.finalizeSpan(span, 'findMostRelevantLinks', messages, completion);

        if (!('choices' in completion)) {
            return [];
        }

        const { links } = JSON.parse(
            completion.choices[0].message.content || "[]"
        );

        if (!links || links.length === 0) {
            return [];
        }

        return links;
    }
} 