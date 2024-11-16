import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { ChatCompletion, ChatCompletionContentPartImage, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { OpenAIService } from "./OpenAIService";
import { LangfuseService } from "./LangfuseService";

const openAIService = new OpenAIService();
const langfuseService = new LangfuseService();

async function performOCR(): Promise<void> {
    const trace = langfuseService.createTrace({
        id: uuidv4(),
        name: 'Map Analysis Task',
        sessionId: uuidv4()
    });

    const dataDir = join(__dirname, 'data');
    const files = await readdir(dataDir);
    const imageFiles = files.filter(file => file.endsWith('.png'));
    
    const images = await Promise.all(
        imageFiles.map(async file => {
            const fileData = await readFile(join(dataDir, file));
            return fileData.toString('base64');
        })
    );

    const messages: ChatCompletionMessageParam[] = [
        {
            role: "system",
            content: `You're going to receive 4 map fragments. 
            Three of them are from the same city, one of them is from a different one - ignore it. 
            Write the name of the city in Polish.
            Write only the name without any additional comments.
            Your response should be:
            <NAME_OF_THE_CITY>`
        },
        {
            role: "user",
            content: images.map(base64Image => ({
                type: "image_url",
                image_url: {
                    url: `data:image/png;base64,${base64Image}`,
                    detail: "high"
                }
            })) as ChatCompletionContentPartImage[]
        }
    ];

    const loggableMessages = messages.map(msg => ({
        ...msg,
        content: Array.isArray(msg.content) 
            ? '[Image Data]'
            : msg.content
    })) as ChatCompletionMessageParam[];

    const visionSpan = langfuseService.createSpan(trace, 'vision_analysis', loggableMessages);
    const chatCompletion = await openAIService.completion(messages, "gpt-4o", false, false, 1024) as ChatCompletion;
    const response = chatCompletion.choices[0].message.content?.trim() || 'no data';
    
    await langfuseService.finalizeSpan(visionSpan, 'vision_analysis', loggableMessages, chatCompletion);

    const city = response.toUpperCase();
    console.log('Identified City:', city);
    
    await langfuseService.finalizeTraceString(trace, [response], city);
    await langfuseService.shutdownAsync();

    const apiKey = process.env.AI_DEVS_API_KEY;
    const responseFlag = await fetch('https://centrala.ag3nts.org/answer', {
        method: 'POST',
        body: `key=${apiKey}&flag=${encodeURIComponent(city)}`,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });
    console.log('Server response:', await responseFlag.json());

}

await performOCR();