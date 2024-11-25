import { OpenAIService } from './OpenAIService';
import { VectorService } from './VectorService';
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';
const COLLECTION_NAME = "weapons_tests";

async function loadFiles(directory: string): Promise<Map<string, string>> {
    const files = await readdir(directory);
    const fileContents = new Map<string, string>();

    for (const file of files.filter(f => f.endsWith('.txt'))) {
        const content = await readFile(join(directory, file), 'utf-8');
        fileContents.set(file, content);
    }

    return fileContents;
}

async function main() {
    const apiKey = process.env.AI_DEVS_API_KEY;
    if (!apiKey) {
        throw new Error('AI_DEVS_API_KEY is not set');
    }

    const openaiService = new OpenAIService();
    const vectorService = new VectorService(openaiService);

    try {
        // 1. Load all TXT files from weapons_tests directory
        console.log('Step 1: Loading weapon test reports...');
        const reports = await loadFiles(join(__dirname, 'data', 'weapons_tests', 'do-not-share'));

        // 2. Initialize collection and add vectors
        console.log('Step 2: Initializing vector collection...');
        await vectorService.ensureCollection(COLLECTION_NAME);

        // 3. Add reports to vector database with filenames as metadata
        console.log('Step 3: Creating points for vector database...');
        const points = Array.from(reports.entries()).map(([filename, content]) => ({
            id: uuidv4(),
            text: content,
            metadata: {
                date: filename.replace('.txt', '').replace(/_/g, '-')
            }
        }));

        console.log(`Adding ${points.length} documents to vector database...`);
        await vectorService.addPoints(COLLECTION_NAME, points);
        console.log('Documents added successfully');

        // 4 & 5. Create embedding for question and search
        const question = "W raporcie, z którego dnia znajduje się wzmianka o kradzieży prototypu broni?";
        console.log('Query:', question);
        
        const results = await vectorService.performSearch(COLLECTION_NAME, question, 1);
        console.log('Search completed');

        if (results.length === 0) {
            throw new Error('No results found');
        }

        // 6. Format the date
        const reportDate = results[0].payload.date;
        
        console.log('Found report date:', reportDate);
        console.log('Score:', results[0].score);
        console.log('Matching text excerpt:', results[0].payload.text.substring(0, 200) + '...');

        // 7. Send report to API
        console.log('Step 7: Sending result to API...');
        const body = {
            task: 'wektory',
            apikey: apiKey,
            answer: reportDate
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
    }
}

main().catch(console.error);