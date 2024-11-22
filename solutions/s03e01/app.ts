import { OpenAIService } from './OpenAIService';
import { v4 as uuidv4 } from 'uuid';
import { readFile, readdir } from 'fs/promises';
import type { ChatCompletion, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { LangfuseService } from './LangfuseService';
import { join } from 'path';
import fetch from 'node-fetch';

const openaiService = new OpenAIService();
const langfuseService = new LangfuseService();

async function loadFiles(directory: string): Promise<Map<string, string>> {
    const files = await readdir(directory);
    const fileContents = new Map<string, string>();

    for (const file of files.filter(f => f.endsWith('.txt'))) {
        const content = await readFile(join(directory, file), 'utf-8');
        fileContents.set(file, content);
    }

    return fileContents;
}

async function getPersonDetails(trace: any, fact: string): Promise<string> {
    const messages: ChatCompletionMessageParam[] = [{
        role: 'system',
        content: `Analyze the user provided fact and extract information about the person mentioned.
        Provide a clear description of who the person is and their important details.
        Include _thinking tags to explain your reasoning.
        Format your response like this:
        
        <answer>
        Name, Profession, Skills, Organizations, Locations, Case-specific identifiers, Key objects or concepts
        </answer>
        `
    }, {
        role: 'user',
        content: `${fact}`
    }];

    const span = langfuseService.createSpan(trace, 'get_person_details');
    const response = await openaiService.completion(messages, 'gpt-4o-mini', false) as ChatCompletion;
    await langfuseService.finalizeSpan(span, 'get_person_details', messages, response);

    const content = response.choices[0].message.content || '';
    const match = content.match(/<answer>(.*?)<\/answer>/s);
    return match ? match[1].trim() : '';
}

async function generateKeywords(reportFilename: string, report: string, reports: Map<string, string>, facts: Map<string, string>, trace: any): Promise<string> {
    // First, analyze each fact to get person details
    const factsWithDetails = await Promise.all(
        Array.from(facts.entries())
            .filter(([_, content]) => !content.includes("entry deleted"))
            .map(async ([filename, content]) => {
                const personDetails = await getPersonDetails(trace, content);
                return `${filename}:\n${content}\n${personDetails}`;
            })
    );

    // Join facts with details and reports into context
    const enrichedFactsContent = factsWithDetails.join('\n\n');
    const reportsContent = Array.from(reports.entries())
        .map(([filename, content]) => `${filename}:\n${content}`)
        .join('\n\n');

    const messages: ChatCompletionMessageParam[] = [{
        role: 'system',
        content: `
        <context>
        Facts with Person Details:
        ${enrichedFactsContent}

        Related Reports:
        ${reportsContent}
        </context>

        You are an AI assistant specialized in extracting keywords from Polish documents. 
        Your task is to analyze user provided report and generate precise, searchable keywords with special focus on people, their professions and skills.
        Use the provided person details from facts to ensure accurate information about people mentioned in the report.
        First keyword should be the name of the person, if the report is about a person.
        Then, add the person's profession, skills and any other details as keywords, based on the enriched facts.
        Then, add other keywords that are relevant to the report, like locations, sector identifiers, etc.
        Include as many relevant keywords to that person as possible, but maximum 20 keywords in total.

        
        Output Requirements:
        1. Keywords must be:
           - Polish nouns in nominative case
           - Separated by commas
           - Unique (no duplicates)
           - Listed in order of relevance
           - When mentioning a person, include their profession if available, skills, and any other details as keywords
           - Animals, plants and other non-human entities should be mentioned by their scientific names
        
        2. Keywords should NOT include:
           - Adjectives or verbs
           - Generic terms with low search value
           - Redundant variations of the same concept
           - Common words without specific search value

        Put your answer within <answer> tags, like this:

        <answer>
        Name of the person (if applicable), details about the person (if applicable), other keywords, locations, sector identifiers, etc.
        </answer>
        `
    }, {
        role: 'user',
        content: `Analyze and generate keywords for:\n\n${reportFilename}:\n${report}`
    }];

    const span = langfuseService.createSpan(trace, 'generate_keywords');
    const response = await openaiService.completion(messages, 'gpt-4o-mini', false) as ChatCompletion;
    await langfuseService.finalizeSpan(span, 'generate_keywords', messages, response);

    const content = response.choices[0].message.content || '';
    const match = content.match(/<answer>(.*?)<\/answer>/s);
    const keywords = match ? match[1].trim() : '';

    return keywords;
}

async function main() {
    const apiKey = process.env.AI_DEVS_API_KEY;
    if (!apiKey) {
        throw new Error('AI_DEVS_API_KEY is not set');
    }

    const trace = langfuseService.createTrace({
        id: uuidv4(),
        name: 'Document Keywords',
        sessionId: uuidv4()
    });

    try {
        // Load reports and facts
        const reports = await loadFiles(join(__dirname, 'data'));
        const facts = await loadFiles(join(__dirname, 'data', 'facts'));

        // Generate keywords for each report
        const keywordsMap: Record<string, string> = {};

        for (const [filename, content] of reports) {
            const keywords = await generateKeywords(filename, content, reports, facts, trace);
            keywordsMap[filename] = keywords;
        }

        console.log('Keywords:', keywordsMap);

        console.log('Sending results to server...');
        // Send results to server
        const body = {
            task: 'dokumenty',
            apikey: apiKey,
            answer: keywordsMap
        };

        const response = await fetch('https://centrala.ag3nts.org/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        console.log('Server response:', await response.json());

    } catch (error) {
        console.error('Error:', error);
        throw error;
    } finally {
        await langfuseService.shutdownAsync();
    }
}

main().catch(console.error);