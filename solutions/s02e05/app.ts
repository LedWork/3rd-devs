import { OpenAIService } from './OpenAIService';
import { v4 as uuidv4 } from 'uuid';
import { readFile, writeFile, access } from 'fs/promises';
import type { ChatCompletion, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { LangfuseService } from './LangfuseService';
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import { createReadStream } from 'fs';
import { pipeline } from 'stream/promises';
import got from 'got';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { previewImageSystemMessage, extractImageContextSystemMessage, refineDescriptionSystemMessage } from './prompts';
import { trace } from 'console';

// Update the type definition for Image
export type Image = {
    alt: string;
    url: string;
    context: string;
    description: string;
    preview: string;
    base64: string;
    name: string;
};

interface MediaItem {
    url: string;
    type: 'image' | 'audio';
    context: string;
    description?: string;
    transcription?: string
    caption?: string;
}

const openaiService = new OpenAIService();
const langfuseService = new LangfuseService();

async function loadQuestions(filePath: string): Promise<Map<string, string>> {
    console.log("Loading questions from:", filePath);
    const content = await readFile(filePath, 'utf-8');
    const questions = new Map<string, string>();
    
    content.split('\n').forEach(line => {
        const [id, question] = line.split('=');
        if (id && question) {
            questions.set(id.trim(), question.trim());
        }
    });
    
    return questions;
}

async function downloadAndConvertHtml(url: string): Promise<string> {
    console.log("Downloading HTML from:", url);
    const response = await fetch(url);
    const html = await response.text();
    
    // Parse HTML and convert relative URLs to absolute
    const dom = new JSDOM(html, { url });
    const document = dom.window.document;
    
    // Convert relative URLs to absolute
    ['src', 'href'].forEach(attr => {
        document.querySelectorAll(`[${attr}]`).forEach((element: Element) => {
            const value = element.getAttribute(attr);
            if (value) {
                element.setAttribute(attr, new URL(value, url).href);
            }
        });
    });
    
    // Convert to markdown
    const turndownService = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced'
    });
    
    return turndownService.turndown(document.body);
}

async function downloadFile(url: string): Promise<Buffer> {
    const buffer = await got(url).buffer();
    return buffer;
}

async function extractImages(article: string): Promise<Image[]> {
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const matches = [...article.matchAll(imageRegex)];

    const imagePromises = matches.map(async ([, alt, url]) => {
        try {
            const name = url.split('/').pop() || '';
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
            const arrayBuffer = await response.arrayBuffer();
            const base64 = Buffer.from(arrayBuffer).toString('base64');

            return {
                alt,
                url,
                context: '',
                description: '',
                preview: '',
                base64,
                name
            };
        } catch (error) {
            console.error(`Error processing image ${url}:`, error);
            return null;
        }
    });

    const results = await Promise.all(imagePromises);
    return results.filter((link): link is Image => link !== null);
}

// Update the previewImage function signature
async function previewImage(image: Image): Promise<{ name: string; preview: string }> {
    const userMessage: ChatCompletionMessageParam = {
        role: 'user',
        content: [
            {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${image.base64}` }
            },
            {
                type: "text",
                text: `Describe the image ${image.name} concisely. Focus on the main elements and overall composition. Return the result in JSON format with only 'name' and 'preview' properties.`
            }
        ]
    };

    const response = await openaiService.completion([previewImageSystemMessage, userMessage], 'gpt-4o', false, true) as ChatCompletion;
    const result = JSON.parse(response.choices[0].message.content || '{}');
    return { name: result.name || image.name, preview: result.preview || '' };
}

async function getImageContext(title: string, article: string, images: Image[]): Promise<{ images: Array<{ name: string, context: string, preview: string }> }> {
    const userMessage: ChatCompletionMessageParam = {
        role: 'user',
        content: `Title: ${title}\n\n${article}`
    };

    const response = await openaiService.completion([extractImageContextSystemMessage(images), userMessage], 'gpt-4o', false, true) as ChatCompletion;
    const result = JSON.parse(response.choices[0].message.content || '{}');

    // Generate previews for all images simultaneously
    const previewPromises = images.map(image => previewImage(image));
    const previews = await Promise.all(previewPromises);

    // Merge context and preview information
    const mergedResults = result.images.map((contextImage: { name: string, context: string }) => {
        const preview = previews.find(p => p.name === contextImage.name);
        return {
            ...contextImage,
            preview: preview ? preview.preview : ''
        };
    });

    return { images: mergedResults };
}

// Update the refineDescription function signature
async function refineDescription(trace: any, image: Image): Promise<Image> {
    const span = langfuseService.createSpan(trace, 'refine_description', image.name);
    
    try {
        const userMessage: ChatCompletionMessageParam = {
            role: 'user',
            content: [
                {
                    type: "image_url",
                    image_url: { url: `data:image/jpeg;base64,${image.base64}` }
                },
                {
                    type: "text",
                    text: `Write a description of the image ${image.name}. I have some <context>${image.context}</context> that should be useful for understanding the image in a better way. An initial preview of the image is: <preview>${image.preview}</preview>. A good description briefly describes what is on the image, and uses the context to make it more relevant to the article. The purpose of this description is for summarizing the article, so we need just an essence of the image considering the context, not a detailed description of what is on the image.`
                }
            ]
        };

        const response = await openaiService.completion([refineDescriptionSystemMessage, userMessage], 'gpt-4o', false) as ChatCompletion;
        const result = response.choices[0].message.content || '';
        
        await langfuseService.finalizeSpan(span, 'refine_description', [refineDescriptionSystemMessage, userMessage], response);
        return { ...image, description: result };
        
    } catch (error) {
        console.error(`Error refining description for image ${image.name}:`, error);
        throw error;
    }
}

/**
 * Generates a detailed summary by orchestrating all processing steps, including embedding relevant links and images within the content.
 */
async function processAndSummarizeImages(trace: any, title: string, path: string) {
    // Read the article file
    const article = await readFile(path, 'utf-8');

    // Extract images from the article
    const images = await extractImages(article);
    console.log('Number of images found:', images.length);

    const contexts = await getImageContext(title, article, images);
    console.log('Number of image metadata found:', contexts.images.length);

    // Process each image: use context and preview from getImageContext, then refine description
    const processedImages = await Promise.all(images.map(async (image) => {
        const { context = '', preview = '' } = contexts.images.find(ctx => ctx.name === image.name) || {};
        return await refineDescription(trace, { ...image, preview, context });
    }));

    // Prepare and save the summarized images (excluding base64 data)
    const describedImages = processedImages.map(({ base64, ...rest }) => rest);
    await writeFile(join(__dirname, 'descriptions.json'), JSON.stringify(describedImages, null, 2));

    // Prepare and save the final data (only url and description)
    const captions = describedImages.map(({ url, description }) => ({ url, description }));
    await writeFile(join(__dirname, 'captions.json'), JSON.stringify(captions, null, 2));

    // Log completion messages
    console.log('Final data saved to captions.json');
}

async function processImages(markdown: string, trace: any): Promise<MediaItem[]> {
    const mediaItems: MediaItem[] = [];
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const imageMatches = [...markdown.matchAll(imageRegex)];
    
    if (imageMatches.length > 0) {
        const tempPath = join(__dirname, 'temp_markdown.md');
        await writeFile(tempPath, markdown, 'utf-8');

        // Process images using the robust processAndSummarizeImages function
        await processAndSummarizeImages(trace, 'Article', tempPath);

        // Read the processed descriptions
        const descriptionsPath = join(__dirname, 'descriptions.json');
        const descriptions = JSON.parse(await readFile(descriptionsPath, 'utf-8'));
        const captions = JSON.parse(await readFile(join(__dirname, 'captions.json'), 'utf-8'));

        // Convert the processed images to MediaItems
        for (const desc of descriptions) {
            const span = langfuseService.createSpan(trace, 'process_image', desc.url);
            
            mediaItems.push({
                url: desc.url,
                type: 'image',
                context: desc.context,
                description: desc.description,
                caption: captions.find(c => c.url === desc.url)?.description || ''
            });

            await langfuseService.finalizeSpanString(span, 'process_image', desc.url, desc.description);
        }

        // Clean up temporary files
        try {
            await unlink(tempPath);
        } catch (error) {
            console.error('Error cleaning up temporary files:', error);
        }
    }

    return mediaItems;
}

async function processAudio(markdown: string, trace: any): Promise<MediaItem[]> {
    const mediaItems: MediaItem[] = [];
    const audioRegex = /\[(.*?)\]\((.*?\.mp3)\)/g;
    const audioMatches = [...markdown.matchAll(audioRegex)];

    for (const [_, text, relativeUrl] of audioMatches) {
        console.log("Audio:", text, relativeUrl);
        const span = langfuseService.createSpan(trace, 'process_audio', relativeUrl);
        
        try {
            // Construct absolute URL if needed
            const absoluteUrl = relativeUrl.startsWith('http') 
                ? relativeUrl 
                : `https://centrala.ag3nts.org/dane/${relativeUrl}`;

            // Download the audio file
            const audioBuffer = await downloadFile(absoluteUrl);
            const tempAudioPath = join(__dirname, 'temp_audio.mp3');
            await writeFile(tempAudioPath, audioBuffer);

            // Get transcription using OpenAI's Whisper model
            const transcription = await openaiService.transcribeGroq(audioBuffer, `transcription_${relativeUrl.split('/').pop()}.mp3`);
            console.log("Transcription:", transcription);

            // Get context for the audio file
            const userMessage: ChatCompletionMessageParam = {
                role: 'user',
                content: transcription
            };

            const messages: ChatCompletionMessageParam[] = [{
                role: 'system',
                content: `You are an AI assistant specialized in understanding document context. 
                Provide a brief context for the audio transcript based on the following markdown content:
                ${markdown}`
            }, userMessage];

            const contextResponse = await openaiService.completion(messages, 'gpt-4o', false) as ChatCompletion;
            await langfuseService.finalizeSpan(span, 'process_audio', messages, contextResponse);

            mediaItems.push({
                url: relativeUrl,
                type: 'audio',
                context: contextResponse.choices[0].message.content || '',
                transcription: transcription
            });

            // Clean up temporary audio file
            await unlink(tempAudioPath);

        } catch (error) {
            console.error(`Error processing audio file ${relativeUrl}:`, error);
        } 
    }

    return mediaItems;
}

async function processMediaItems(markdown: string, trace: any): Promise<MediaItem[]> {
    const mediaItems: MediaItem[] = [];
    
    // Process images
    const imageItems = await processImages(markdown, trace);
    mediaItems.push(...imageItems);

    // Process audio files
    const audioItems = await processAudio(markdown, trace);
    mediaItems.push(...audioItems);

    return mediaItems;
}

async function fileExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

async function main() {
    const apiKey = process.env.AI_DEVS_API_KEY;
    if (!apiKey) {
        throw new Error('AI_DEVS_API_KEY is not set');
    }
    
    const trace = langfuseService.createTrace({
        id: uuidv4(),
        name: 'Article Analysis',
        sessionId: uuidv4()
    });

    try {
        // Load questions
        const questions = await loadQuestions('solutions/s02e05/data/questions.txt');
        console.log("Loaded questions:", questions);

        let enhancedContent = '';
        if (await fileExists('solutions/s02e05/data/enhanced.md')) {    
            console.log("Enhanced.md exists, skipping processing");
            // Read the existing enhanced content
            enhancedContent = await readFile('solutions/s02e05/data/enhanced.md', 'utf-8');
        } else {
            // Download and convert HTML
            const articleUrl = "https://centrala.ag3nts.org/dane/arxiv-draft.html";
            const markdown = await downloadAndConvertHtml(articleUrl);
            
            // Save markdown for debugging (optional)
            await writeFile('solutions/s02e05/data/article.md', markdown, 'utf-8');
            
            // Process all media items
            const mediaItems = await processMediaItems(markdown, trace);
            
            // Create an enhanced version of the markdown with descriptions and transcriptions
            enhancedContent = markdown;
            for (const item of mediaItems) {
                console.log("Item:", item.url);
                if (item.type === 'image' && item.description) {
                    enhancedContent += `\nImage Description (${item.url}): ${item.description}\n`;
                } else if (item.type === 'audio' && item.transcription) {
                    enhancedContent += `\nAudio Transcription (${item.url}): ${item.transcription}\n`;
                    enhancedContent += `\nAudio Context (${item.url}): ${item.context}\n`;
                }
            }

            // save enhanced content
            await writeFile('solutions/s02e05/data/enhanced.md', enhancedContent, 'utf-8');
        }

        console.log("Article processed successfully");

        // Now process with GPT-4
        const messages: ChatCompletionMessageParam[] = [{
            role: 'system',
            content: `You are an AI assistant helping to analyze scientific articles. 
            The content includes image descriptions and audio transcriptions.
            You are given a set of questions that you need to answer based on the content.
            The questions are: 
            <questions>
            ${Array.from(questions.values()).join('\n')}
            </questions>
            Provide your answer in the same language and order as the questions as short as possible (1 sentence per question).
            Each response should be in a separate line.
            Enclose the response in <answers> tag, like this:
            <answers>
            response1
            response2
            ...
            </answers>
            `
        }, {
            role: 'user',
            content: enhancedContent
        }];

        const span = langfuseService.createSpan(trace, 'process_article', messages);
        const response = await openaiService.completion(messages, "gpt-4o", false) as ChatCompletion;
        await langfuseService.finalizeSpan(span, 'process_article', messages, response);
        
        // extract answer from response
        const answerRegex = /<answers>(.*?)<\/answers>/s;
        const answer = response.choices[0].message.content?.match(answerRegex)?.[1] || '';
        const answers = answer.split('\n').filter(line => line.trim().length > 0);
        console.log("Answers:", answer);

        // Create map of answers with padded numbers as keys
        const answersMap = new Map(
            answers.map((answer, index) => [
                String(index + 1).padStart(2, '0'), 
                answer.trim()
            ])
        );

        // Convert map to formatted JSON object
        const answersJson = Object.fromEntries(
            Array.from(answersMap.entries()).map(([key, value]) => [
                `${key}`,
                value
            ])
        );
        console.log("Answers json:", answersJson);
        
        const body = {
            task: 'arxiv',
            apikey: apiKey,
            answer: answersJson
        };
    
        console.log('Sending report to server...', body);
        const responseFlag = await fetch('https://centrala.ag3nts.org/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    
        console.log('Server response:', await responseFlag.json());
    } catch (error) {
        console.error('Error:', error);
        throw error;
    } finally {
        await langfuseService.shutdownAsync();
    }
}

main().catch(console.error);