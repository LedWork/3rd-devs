import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'fs';
import type { ChatCompletion, ChatCompletionContentPartImage, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { OpenAIService } from "./OpenAIService";
import { LangfuseService } from "./LangfuseService";

const openAIService = new OpenAIService();
const langfuseService = new LangfuseService();

async function performOCR(): Promise<void> {
    const apiKey = process.env.AI_DEVS_API_KEY;
    if (!apiKey) {
        throw new Error('AI_DEVS_API_KEY is not set');
    }

    // 1. Get robot description
    const response = await fetch(`https://centrala.ag3nts.org/data/${apiKey}/robotid.json`);
    const robotDescription = await response.json();
    console.log('Robot Description:', robotDescription);

    // 2. Create trace for monitoring
    const trace = langfuseService.createTrace({
        id: uuidv4(),
        name: 'Robot Image Generation',
        sessionId: uuidv4()
    });

    // 3. Generate DALL-E prompt
    const messages: ChatCompletionMessageParam[] = [
        {
            role: "system",
            content: `Create a detailed prompt for DALL-E 3 to generate an image of a robot based on the given description. 
            Focus on visual details and maintain a professional technical style.`
        },
        {
            role: "user",
            content: robotDescription.description
        }
    ];

    // 4. Generate and track prompt
    const promptSpan = langfuseService.createSpan(trace, 'prompt_generation', messages);
    const chatCompletion = await openAIService.completion(messages, "gpt-4o-mini", false, false, 1024) as ChatCompletion;
    const imagePrompt = chatCompletion.choices[0].message.content?.trim() || '';
    await langfuseService.finalizeSpan(promptSpan, 'prompt_generation', messages, chatCompletion);

    // 5. Generate image
    const imageResponse = await openAIService.generateImage(imagePrompt, "1024x1024", "url");
    const imageUrl = imageResponse.data[0]?.url;

    if (!imageUrl) {
        console.error('No image generated');
        await langfuseService.finalizeTraceString(trace, [imagePrompt], 'no image generated');
        await langfuseService.shutdownAsync();
        return;
    }

    // 6. Save image
    const commonPath = './solutions/s02e03/data';
    const fileName = await fs.access(`${commonPath}/image.png`)
        .then(() => `image-${uuidv4()}.png`)
        .catch(() => 'image.png');

    const imageBuffer = Buffer.from(await (await fetch(imageUrl)).arrayBuffer());
    await fs.writeFile(`${commonPath}/${fileName}`, imageBuffer);

    // 7. Report results
    await langfuseService.finalizeTraceString(trace, [imagePrompt], imageUrl);
    await langfuseService.shutdownAsync();

    const body = {
        task: 'robotid',
        apikey: apiKey,
        answer: imageUrl
    };

    const responseFlag = await fetch('https://centrala.ag3nts.org/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    console.log('Server response:', await responseFlag.json());
}

await performOCR();