import { readFile } from 'fs/promises';
import { join } from 'path';
import type { ChatCompletion, ChatCompletionContentPartImage, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { OpenAIService } from "./OpenAIService";

const openAIService = new OpenAIService();

async function performOCR(): Promise<void> {
    const imagePath = join(__dirname, 'data', 'vision.jpg');
    const fileData = await readFile(imagePath);
    const base64Image = fileData.toString('base64');

    const messages: ChatCompletionMessageParam[] = [
        {
            role: "system",
            content: "You are an OCR assistant. Read all text from the image and output it exactly as it appears, preserving formatting and layout. If no text can be found or read in the image, respond with exactly 'no text' without any additional explanation."
        },
        {
            role: "user",
            content: [
                {
                    type: "image_url",
                    image_url: {
                        url: `data:image/jpeg;base64,${base64Image}`,
                        detail: "high"
                    }
                } as ChatCompletionContentPartImage,
                {
                    type: "text",
                    text: "Please read and output all text from this image, preserving the formatting."
                }
            ]
        }
    ];

    const chatCompletion = await openAIService.completion(messages, "gpt-4o", false, false, 1024) as ChatCompletion;
    const response = chatCompletion.choices[0].message.content?.trim() || 'no text';
    
    console.log(response);
}

await performOCR();