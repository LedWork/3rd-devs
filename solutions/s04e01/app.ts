import { ImageService } from "./ImageService";
import { OpenAIService } from "./OpenAIService";
import dotenv from 'dotenv';
import { prompt as identifyWomanPrompt } from "./prompts/identify_woman";
import { logger } from "../common/logger";
import { LangfuseService } from './LangfuseService';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { ChatCompletionMessageParam, type ChatCompletion } from 'openai/resources/index';
dotenv.config();

const imageService = new ImageService(
    process.env.AI_DEVS_API_KEY as string,
    "https://centrala.ag3nts.org/dane/barbara/{new_photo_name}",
    "https://centrala.ag3nts.org/report"
);

const openAIService = new OpenAIService();
const langfuseService = new LangfuseService();

const descriptions: string[] = [];
const HISTORY_FILE = path.join(__dirname, 'data/action-history.json');
let actionHistory: Record<string, string> = {};

const trace = langfuseService.createTrace({
    id: uuidv4(),
    name: 'Photo Processing',
    sessionId: uuidv4()
});

async function loadActionHistory() {
    try {
        const data = await fs.readFile(HISTORY_FILE, 'utf-8');
        actionHistory = JSON.parse(data);
        logger.info(`Loaded ${Object.keys(actionHistory).length} actions from history`);
    } catch (error) {
        logger.debug('No history file found, starting fresh');
        actionHistory = {};
    }
}

async function extractImages(response: string): Promise<string[]> {
    // Regex for image filenames (IMG_1234.PNG, image.jpg, etc.), even within URLs
    const imageNameRegex = /[\w-]+\.(?:jpg|jpeg|png|gif)\b/gi;
    const imageNames = [...new Set(response.match(imageNameRegex) || [])];
    
    return imageNames;
}

async function getDescription(imageName: string): Promise<string> {
    return await imageService.getDescription(imageName);    
}

async function getAction(imageName: string) {
    logger.info(`Downloading original image: ${imageName}`);
    const imagePath = await imageService.downloadImage(imageName, imageName);
    const action = (await imageService.analyzeImage(imagePath)).action;
    logger.debug(`Action: ${action}`);
    
    actionHistory[imageName] = action;
    await fs.writeFile(HISTORY_FILE, JSON.stringify(actionHistory, null, 2));

    return action;
}

async function processImage(imageName: string) {
    let action: string;
    if (actionHistory[imageName]) {
        logger.info(`Found cached action for ${imageName}: ${actionHistory[imageName]}`);
        action = actionHistory[imageName];
    } else {
       action = await getAction(imageName);
    }

    if (action === 'NONE') {
        logger.debug(`No action found for ${imageName}`);
        return;
    }

    if (action === 'GOOD') {
        const womanDescription = await getDescription(imageName);
        logger.debug(`Woman description: ${womanDescription}`);
        if (womanDescription !== 'NONE') {
            logger.success(`Found woman in ${imageName}: ${womanDescription}`);
            descriptions.push(womanDescription);
        } else {
            logger.debug(`No woman found in ${imageName}`);
        }
        return;
    }

    const response = await imageService.processCommand(`${action} ${imageName}`);
    console.log(response.message);
    // Check if we got a new image in response
    const processedImages = await extractImages(response.message);
    if (processedImages.length > 0) {
        const newImage = processedImages[0]; // Take the first image
        await processImage(newImage);
    } else {
        logger.error(`No new image found in response: ${response}`);
    }
}

async function processPhotos() {
    try {
        await loadActionHistory();
        logger.info("Starting photo processing session...");
        const initialResponse = await imageService.initSession();
        logger.debug("Initial response:", initialResponse);

        const images = await extractImages(initialResponse.message);
        logger.info(`Found ${images.length} images to process`);
        logger.debug("Images:", images);
        
        for (const img of images) {
            logger.processing(`Processing image: ${img}`);
            await processImage(img);
        }

        logger.info(`Found ${descriptions.length} descriptions`);
        logger.debug("Descriptions:", descriptions);
        for (const desc of descriptions) {
            const response = await imageService.submitDescription(desc);
            logger.debug("Submit response:", response);
        }
    } catch (error) {
        logger.error("Error processing photos:", error);
        throw error;
    } finally {
        await langfuseService.finalizeTrace(trace, [], []);
    }
}

processPhotos().catch(console.error);
