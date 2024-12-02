import { OpenAIService, ImageProcessingResult } from "./OpenAIService";
import fs from 'fs/promises';
import path from 'path';
import { logger } from "../common/logger";
import fetch from 'node-fetch';

export class ImageService {
    private openAIService: OpenAIService;
    private apiKey: string;
    private baseUrl: string;
    private reportUrl: string;
    private downloadDir: string;

    constructor(apiKey: string, baseUrl: string, reportUrl: string) {
        this.openAIService = new OpenAIService();
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
        this.reportUrl = reportUrl;
        this.downloadDir = path.join(__dirname, 'data');
    }

    async initSession(): Promise<any> {
        logger.info("Initializing session...");
        const response = await fetch(this.reportUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                task: "photos",
                apikey: this.apiKey,
                answer: "START"
            })
        });
        return await response.json();
    }

    async processCommand(command: string): Promise<any> {
        logger.info(`Processing command: ${command}`);
        const response = await fetch(this.reportUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                task: "photos",
                apikey: this.apiKey,
                answer: command
            })
        });
        return await response.json();
    }

    async downloadImage(imageName: string, filename: string): Promise<string> {
        const url = this.baseUrl.replace('{new_photo_name}', imageName);
        logger.info(`Downloading image from ${url}`);

        await fs.mkdir(this.downloadDir, { recursive: true });
        const filepath = path.join(this.downloadDir, filename);
        
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();

        await fs.writeFile(filepath, Buffer.from(buffer));
        logger.success(`Image saved to ${filepath}`);
        return filepath;
    }

    async analyzeImage(imagePath: string): Promise<any> {
        logger.info(`Analyzing image: ${imagePath}`);
        const result = await this.openAIService.processImage(imagePath);
        logger.debug(`Analysis result:`, result);
        return result;
    }

    async getDescription(imageName: string): Promise<string> {
        logger.info(`Getting description for image: ${imageName}`);
        const filepath = path.join(this.downloadDir, imageName);
        return await this.openAIService.getDescription(filepath);
    }

    async submitDescription(description: string): Promise<any> {
        logger.info(`Submitting description: ${description}`);
        const response = await fetch(this.reportUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                task: "photos",
                apikey: this.apiKey,
                answer: description
            })
        });
        return await response.json();
    }
} 