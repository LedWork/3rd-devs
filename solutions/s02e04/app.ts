import { OpenAIService } from './OpenAIService';
import { v4 as uuidv4 } from 'uuid';
import { readFile, readdir } from 'fs/promises';
import { join, extname } from 'path';
import type { ChatCompletion, ChatCompletionContentPartImage, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { LangfuseService } from './LangfuseService';

const openaiService = new OpenAIService();
const langfuseService = new LangfuseService();

const ANALYSIS_PROMPT_TEMPLATE = `Analyze the {INPUT_TYPE} and determine if the data includes the following types of information:
1. PEOPLE (humans only): about detained individuals or traces of their presence, but only if they were observed or detained; otherwise, this does not fall under this category.
2. SOFTWARE (digital programs only): issues with software.
3. HARDWARE (physical objects only): physical problems with devices, hardware issues.
In your response, specify the category to which the information belongs.
You have three available categories: people, hardware, software. If the information does not match any of these categories, return NONE.
Answer only one word: people, hardware, software, or NONE.

Examples:
- "AI module was updated" → SOFTWARE (digital program was updated)
- "Security camera was replaced" → HARDWARE (physical object was replaced)
- "Found footprints in sector B" → PEOPLE (evidence of presence)
- "Searching for intruders" → NONE (action, not presence)
- "a boy named John delivers food" → NONE (just a description, without any evidence of presence)
- "a girl named Mary is well known in the area" → NONE (presence not mentioned)
- "a cat named Whiskers is playing with a ball" → NONE (not a person)
- "Judy was captured near the south gate" → PEOPLE (evidence of presence)
- "Robot arm was repaired" → HARDWARE (physical object was repaired)
- "Operating system restored" → SOFTWARE (digital program was restored)

Respond strictly with one word: PEOPLE, HARDWARE, SOFTWARE, or NONE.
If unsure or no clear evidence, answer NONE.
`;

async function processTextFile(filePath: string, model: string = 'gpt-4o', trace: any): Promise<string> {
    console.log("Processing text file:", filePath);
    const content = await readFile(filePath, 'utf-8');
    
    const span = langfuseService.createSpan(trace, `process_text_${filePath}`);
    
    const messages: ChatCompletionMessageParam[] = [{
        role: 'system',
        content: ANALYSIS_PROMPT_TEMPLATE.replace('{INPUT_TYPE}', 'text')
    }, {
        role: 'user',
        content
    }];
    const response = await openaiService.completion(messages, model, false) as ChatCompletion;
    await langfuseService.finalizeSpan(span, `process_text_${filePath}`, messages, response);
    return response.choices[0].message.content || '';
}

async function processImageFile(filePath: string, model: string = 'gpt-4o', trace: any): Promise<string> {
    console.log("Processing image file:", filePath);
    const imageBuffer = await readFile(filePath);
    const base64Image = imageBuffer.toString('base64');
    
    const span = langfuseService.createSpan(trace, `process_image_${filePath}`);
    
    const messagesOCR: ChatCompletionMessageParam[] = [{
        role: 'system',
        content: `Extract text from the image. Respond only with the text that you see, nothing else.`
    }, {
        role: 'user',
        content: [
            {
                type: "image_url",
                image_url: {
                    url: `data:image/png;base64,${base64Image}`,
                    detail: "high"
                }
            }
        ]
    }];
    
    const loggableMessages = messagesOCR.map(msg => ({
        ...msg,
        content: Array.isArray(msg.content) 
            ? '[Image Data]'
            : msg.content
    })) as ChatCompletionMessageParam[];
    
    const responseOCR = await openaiService.completion(messagesOCR, "gpt-4o", false) as ChatCompletion;
    await langfuseService.finalizeSpan(span, `process_image_${filePath}`, loggableMessages, responseOCR);

    const messages: ChatCompletionMessageParam[] = [{
        role: 'system',
        content: ANALYSIS_PROMPT_TEMPLATE.replace('{INPUT_TYPE}', 'extracted text')
    }, {
        role: 'user',
        content: responseOCR.choices[0].message.content || ''
    }];

    const spanAnalysis = langfuseService.createSpan(trace, `process_image_analysis_${filePath}`);
    const response = await openaiService.completion(messages, model, false) as ChatCompletion;
    await langfuseService.finalizeSpan(spanAnalysis, `process_image_analysis_${filePath}`, messages, response);
    return response.choices[0].message.content || '';
}

async function processAudioFile(filePath: string, model: string = 'gpt-4o', trace: any): Promise<string> {
    console.log("Processing audio file:", filePath);
    const audioBuffer = await readFile(filePath);
    
    const span = langfuseService.createSpan(trace, `process_audio_${filePath}`);
    
    const transcription = await openaiService.transcribeGroq(audioBuffer, filePath);
    
    const messages: ChatCompletionMessageParam[] = [{
        role: 'system',
        content: ANALYSIS_PROMPT_TEMPLATE.replace('{INPUT_TYPE}', 'transcribed audio')
    }, {
        role: 'user',
        content: transcription
    }];
    const response = await openaiService.completion(messages, model, false) as ChatCompletion;
    await langfuseService.finalizeSpan(span, `process_audio_${filePath}`, messages, response);
    return response.choices[0].message.content || '';
}

async function analyzeResults(results: { fileName: string; content: string }[]): Promise<{ people: string[]; hardware: string[] }> {
    console.log("Analyzing results...");

    const people: string[] = [];
    const hardware: string[] = [];

    for (const result of results) {
        const categoryMatch = /<category>(.*?)<\/category>/i.exec(result.content);
        if (categoryMatch) {
            const category = categoryMatch[1].trim().toUpperCase();
            
            if (category === 'PEOPLE') {
                console.log(`People found: ${result.fileName}`);
                people.push(result.fileName);
            }
            if (category === 'HARDWARE') {
                console.log(`Hardware found: ${result.fileName}`);
                hardware.push(result.fileName);
            }
            if (category === 'SOFTWARE') {
                console.log(`Software skipped: ${result.fileName}`);
            }
        }
    }

    return { people, hardware };
}

async function main() {
    const apiKey = process.env.AI_DEVS_API_KEY;
    if (!apiKey) {
        throw new Error('AI_DEVS_API_KEY is not set');
    }
    
    const dataDir = './solutions/s02e04/data';
    const files = await readdir(dataDir);
    
    const trace = langfuseService.createTrace({
        id: uuidv4(),
        name: 'Multimodal Analysis',
        sessionId: uuidv4()
    });
    
    const validExtensions = new Set(['.txt', '.png', '.mp3']);
    const fileProcessingResults = [];

    for (const file of files) {
        const ext = extname(file).toLowerCase();
        if (!validExtensions.has(ext)) continue;

        const filePath = join(dataDir, file);
        let content = '';

        try {
            switch (ext) {
                case '.txt':
                    content = await processTextFile(filePath, "gpt-4o-mini", trace);
                    break;
                case '.png':
                    content = await processImageFile(filePath, "gpt-4o-mini", trace);
                    break;
                case '.mp3':
                    content = await processAudioFile(filePath, "gpt-4o-mini", trace);
                    break;
            }

            fileProcessingResults.push({
                fileName: file,
                content: `<category>${content}</category>`
            });
        } catch (error) {
            console.error(`Error processing ${file}:`, error);
        }
    }

    const analysis = await analyzeResults(fileProcessingResults);

    await langfuseService.finalizeTraceString(trace, ["Extract people presence and hardware issues"], JSON.stringify(analysis));
    await langfuseService.shutdownAsync();

    const body = {
        task: 'kategorie',
        apikey: apiKey,
        answer: analysis
    };

    console.log('Sending report to server...', body);
    const responseFlag = await fetch('https://centrala.ag3nts.org/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    console.log('Server response:', await responseFlag.json());
}

main().catch(console.error);