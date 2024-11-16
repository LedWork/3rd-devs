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
            content: `You are an OCR assistant. 
            Read all text from the image and output it exactly as it appears, preserving formatting and layout. 
            If no text can be found or read in the image, respond with exactly 'no text' without any additional explanation.`
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

    console.log('Response:', response);
    
    const messages2: ChatCompletionMessageParam[] = [
        {
            role: "system",
            content: `Extract the following information from the text, responding in JSON format: name, surname, social security number (PESEL, if exists), achieved reward, and donated blood per achieved reward (odznaka ZHDK). 
            If any field is not found, set it to null. 
            The reward row consists of the following fields: number (Nr), date of award (Data), issuer of the reward (na wniosek ZR), amount of donated blood (in mililiters). 
            The reward row is repeated for each reward. The text is in Polish.
            
            Create the JSON exactly as described below with example data already filled in:
            {
                gt_parse: {
                   "Surname": "Kowalski",
                   "Name": "Jan",
                   "Date of birth": "8.03.1901",
                   "PESEL": "11223344556",
                   "III st.": {
                        "Nr": "2.344/Gd",
                        "Date": "1.11.95",
                        "ZR": "Wejherowo",
                        "Donated blood": "6,500"
                    },
                    "II st.": {
                        "Nr": "1.500/gd",
                        "Date": "7.09.1905",
                        "ZR": "Wejherowo",
                        "Donated blood": "12,000"
                    },
                    "I st.": {
                        "Nr": "1650/Gd",
                        "Date": "10.11.1996",
                        "Donated blood": "18,450"
                    }
                }
            }
            `
        },
        {
            role: "user",
            content: response
        }
    ];

    const extractionCompletion = await openAIService.completion(messages2, "gpt-4o-mini", false, false, 1024) as ChatCompletion;
    const extractedData = extractionCompletion.choices[0].message.content?.trim() || '{}';
    
    console.log('Extracted Data:', extractedData);
}

await performOCR();