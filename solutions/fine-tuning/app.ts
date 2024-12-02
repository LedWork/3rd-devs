import { readFile } from 'fs/promises';
import { join } from 'path';
import fetch from 'node-fetch';
import { logger } from '../common/logger';
import OpenAI from 'openai';

// Define an interface for the solver
interface ISampleSolver {
    solve(correctLines: string[], incorrectLines: string[], verifyLines: string[]): Promise<string[]>;
}

interface DatasetSplit {
    training: string[];
    validation: string[];
}

// Implement the solver using gpt-4o-mini-2024-07-18 fine-tuning
class GPTSolver implements ISampleSolver {
    private openai: OpenAI;
    private fineTunedModel: string | null = null;
    private readonly VALIDATION_THRESHOLD = 0.9; // 90% accuracy required for validation

    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
    }

    private splitDataset(correctLines: string[], ratio: number = 0.8): DatasetSplit {
        const shuffled = [...correctLines].sort(() => Math.random() - 0.5);
        const splitIndex = Math.floor(shuffled.length * ratio);
        return {
            training: shuffled.slice(0, splitIndex),
            validation: shuffled.slice(splitIndex)
        };
    }

    private async prepareTrainingData(trainingCorrect: string[], incorrectLines: string[]): Promise<any[]> {
        const trainingData = [
            ...trainingCorrect.map(line => ({
                messages: [
                    { role: "system", content: "You are a classifier that determines if a given text is correct or incorrect." },
                    { role: "user", content: line.trim() },
                    { role: "assistant", content: "correct" }
                ]
            })),
            ...incorrectLines.map(line => ({
                messages: [
                    { role: "system", content: "You are a classifier that determines if a given text is correct or incorrect." },
                    { role: "user", content: line.trim() },
                    { role: "assistant", content: "incorrect" }
                ]
            }))
        ];

        return trainingData;
    }

    private async fineTuneModel(trainingData: any[]): Promise<void> {
        try {
            // Convert training data array to JSONL format
            const jsonlContent = trainingData.map(item => JSON.stringify(item)).join('\n');
            // log first 5 lines
            logger.info(`First 5 lines of training data:\n${jsonlContent.split('\n').slice(0, 5).join('\n')}`);
            
            // Create a File object with JSONL content
            const blob = new Blob([jsonlContent], { type: 'application/json' });
            const file = new File([blob], 'training_data.jsonl', { type: 'application/json' });

            // Create fine-tuning job
            const uploadedFile = await this.openai.files.create({
                file,
                purpose: 'fine-tune'
            });

            const fineTuningJob = await this.openai.fineTuning.jobs.create({
                model: 'gpt-4o-mini-2024-07-18',
                training_file: uploadedFile.id
            });

            logger.info(`Fine-tuning job created: ${fineTuningJob.id}`);

            // Wait for fine-tuning to complete
            let job;
            do {
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds between checks
                job = await this.openai.fineTuning.jobs.retrieve(fineTuningJob.id);
                logger.info(`Fine-tuning status: ${job.status}`);
            } while (job.status !== 'succeeded' && job.status !== 'failed');

            if (job.status === 'succeeded') {
                this.fineTunedModel = job.fine_tuned_model;
                logger.info(`Fine-tuning completed. Model ID: ${this.fineTunedModel}`);
            } else {
                throw new Error('Fine-tuning failed', { cause: job });
            }
        } catch (error) {
            logger.error(`Error during fine-tuning: ${error}`);
            throw error;
        }
    }

    private async validateModel(validationSet: string[]): Promise<boolean> {
        if (!this.fineTunedModel) {
            throw new Error('Model not fine-tuned yet');
        }

        logger.info('Starting model validation...');
        let correctPredictions = 0;

        for (const text of validationSet) {
            const isCorrect = await this.classifyText(text);
            if (isCorrect) {
                correctPredictions++;
            }
        }

        const accuracy = correctPredictions / validationSet.length;
        logger.info(`Validation accuracy: ${(accuracy * 100).toFixed(2)}%`);

        return accuracy >= this.VALIDATION_THRESHOLD;
    }

    private async classifyText(text: string): Promise<boolean> {
        if (!this.fineTunedModel) {
            throw new Error('Model not fine-tuned yet');
        }

        const response = await this.openai.chat.completions.create({
            model: this.fineTunedModel,
            messages: [
                { role: "system", content: "You are a classifier that determines if a given text is correct or incorrect." },
                { role: "user", content: text.trim() }
            ],
            temperature: 0.1
        });

        return response.choices[0].message.content?.toLowerCase().includes('correct') ?? false;
    }

    async solve(correctLines: string[], incorrectLines: string[], verifyLines: string[]): Promise<string[]> {
        // Split correct dataset into training and validation sets
        logger.info('Splitting dataset into training and validation sets...');
        const { training: trainingCorrect, validation: validationSet } = this.splitDataset(correctLines);
        logger.info(`Training set size: ${trainingCorrect.length}, Validation set size: ${validationSet.length}`);

        // Prepare and fine-tune the model
        logger.info('Preparing training data...');
        const trainingData = await this.prepareTrainingData(trainingCorrect, incorrectLines);
        
        logger.info('Starting fine-tuning process...');
        await this.fineTuneModel(trainingData);

        // Validate the model
        const isValid = await this.validateModel(validationSet);
        if (!isValid) {
            const error = 'Model validation failed: accuracy below threshold';
            logger.error(error);
            process.exit(1);
        }

        // Classify samples
        logger.info('Model validation successful, proceeding with classification...');
        const results = await Promise.all(
            verifyLines.map(async sample => {
                const [id, content] = sample.split('=').map(s => s.trim());
                const isCorrect = await this.classifyText(content);
                logger.debug(`Classified "${content}" as ${isCorrect ? 'correct' : 'incorrect'}`);
                return { id, isCorrect };
            })
        );

        // Return valid IDs
        return results.filter(r => r.isCorrect).map(r => r.id);
    }
}

async function analyzeSamples(solver: ISampleSolver): Promise<void> {
    // Load reference files and samples
    const correctSamples = await readFile(join(__dirname, 'data/correct.txt'), 'utf-8');
    const incorrectSamples = await readFile(join(__dirname, 'data/incorrect.txt'), 'utf-8');
    const verifyData = await readFile(join(__dirname, 'data/verify.txt'), 'utf-8');

    // Split into lines
    const correctLines = correctSamples.split('\n').filter(Boolean);
    const incorrectLines = incorrectSamples.split('\n').filter(Boolean);
    const verifyLines = verifyData.split('\n').filter(Boolean);

    // Use the solver to find valid IDs
    const validIds = await solver.solve(correctLines, incorrectLines, verifyLines);

    // Send the answer
    const API_KEY = process.env.AI_DEVS_API_KEY;
    const API_URL = 'https://centrala.ag3nts.org/report';

    const requestBody = {
        task: 'research',
        apikey: API_KEY,
        answer: validIds
    };

    logger.info(`Sending answer: ${JSON.stringify(requestBody)}`);

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        });
        const data = await response.json();
        logger.info(`Response: ${JSON.stringify(data)}`);
    } catch (error) {
        logger.error(`Error sending answer: ${error}`);
    }
}

// Instantiate the solver and run the analysis
const solver = new GPTSolver();
analyzeSamples(solver).catch(console.error);
