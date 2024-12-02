import { readFile } from 'fs/promises';
import { join } from 'path';
import fetch from 'node-fetch';
import { logger } from '../common/logger';
import KNN from 'ml-knn';

interface ISampleSolver {
    solve(correctLines: string[], incorrectLines: string[], verifyLines: string[]): Promise<string[]>;
}

class KNNSolver implements ISampleSolver {
    private readonly K_NEIGHBORS = 9;
    private readonly VALIDATION_SPLIT = 0.2;
    private readonly MIN_VALIDATION_ACCURACY = 0.8;
    private readonly NOISE_SCALE = 0.15;
    private readonly AUGMENTATION_FACTOR = 10;
    private means: number[] = [];
    private stds: number[] = [];

    private parseData(line: string): number[] {
        return line.split(',').map(n => parseFloat(n.trim()));
    }

    private standardize(data: number[][], isTraining: boolean = true): number[][] {
        if (isTraining) {
            const numFeatures = data[0].length;
            this.means = new Array(numFeatures).fill(0);
            this.stds = new Array(numFeatures).fill(0);
            
            // Calculate means
            for (const row of data) {
                for (let i = 0; i < numFeatures; i++) {
                    this.means[i] += row[i];
                }
            }
            this.means.forEach((_, i) => this.means[i] /= data.length);
            
            // Calculate standard deviations
            for (const row of data) {
                for (let i = 0; i < numFeatures; i++) {
                    this.stds[i] += Math.pow(row[i] - this.means[i], 2);
                }
            }
            this.stds.forEach((_, i) => this.stds[i] = Math.sqrt(this.stds[i] / data.length));
        }
        
        // Standardize data using stored means and stds
        return data.map(row => 
            row.map((val, i) => (val - this.means[i]) / (this.stds[i] || 1))
        );
    }

    private balanceDatasets(correctData: number[][], incorrectData: number[][]): [number[][], number[][]] {
        const minSize = Math.min(correctData.length, incorrectData.length);
        
        const shuffleArray = (array: number[][]): number[][] => {
            for (let i = array.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [array[i], array[j]] = [array[j], array[i]];
            }
            return array;
        };

        const balancedCorrect = shuffleArray([...correctData]).slice(0, minSize);
        const balancedIncorrect = shuffleArray([...incorrectData]).slice(0, minSize);

        return [balancedCorrect, balancedIncorrect];
    }

    private splitDataset(data: number[][], labels: number[]): [number[][], number[][], number[], number[]] {
        const indices = Array.from({ length: data.length }, (_, i) => i);
        for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]];
        }
        
        const shuffledData = indices.map(i => data[i]);
        const shuffledLabels = indices.map(i => labels[i]);
        
        const totalSize = data.length;
        const trainSize = Math.floor(totalSize * (1 - this.VALIDATION_SPLIT));
        
        const trainData = shuffledData.slice(0, trainSize);
        const validData = shuffledData.slice(trainSize);
        const trainLabels = shuffledLabels.slice(0, trainSize);
        const validLabels = shuffledLabels.slice(trainSize);
        
        return [trainData, validData, trainLabels, validLabels];
    }

    private augmentData(data: number[][]): number[][] {
        const augmented: number[][] = [...data];
        
        // Create synthetic samples by adding random noise
        for (let i = 0; i < data.length * (this.AUGMENTATION_FACTOR - 1); i++) {
            const baseIndex = i % data.length;
            const newSample = data[baseIndex].map(value => {
                const noise = (Math.random() - 0.5) * 2 * this.NOISE_SCALE * Math.abs(value);
                return value + noise;
            });
            augmented.push(newSample);
        }
        
        return augmented;
    }

    async solve(correctLines: string[], incorrectLines: string[], verifyLines: string[]): Promise<string[]> {
        logger.info('Preparing training data...');
        
        // Parse data first, then balance, then augment
        const correctData = correctLines.map(line => this.parseData(line));
        const incorrectData = incorrectLines.map(line => this.parseData(line));
        
        // Balance before augmentation
        const [balancedCorrect, balancedIncorrect] = this.balanceDatasets(correctData, incorrectData);
        
        // Augment after balancing
        const augmentedCorrect = this.augmentData(balancedCorrect);
        const augmentedIncorrect = this.augmentData(balancedIncorrect);
        
        logger.info(`Dataset sizes - Correct: ${augmentedCorrect.length}, Incorrect: ${augmentedIncorrect.length}`);

        // Combine training data and create labels
        const allData = [...augmentedCorrect, ...augmentedIncorrect];
        const standardizedData = this.standardize(allData, true);  // Calculate and store standardization parameters
        const labels = [
            ...new Array(augmentedCorrect.length).fill(1),
            ...new Array(augmentedIncorrect.length).fill(0)
        ];

        // Split into training and validation sets
        const [trainData, validData, trainLabels, validLabels] = this.splitDataset(standardizedData, labels);

        // Train KNN model
        logger.info('Training KNN model...');
        const knn = new KNN(trainData, trainLabels, { k: this.K_NEIGHBORS });

        // Validate model
        logger.info('Validating model...');
        const validationPredictions = knn.predict(validData);
        const accuracy = validationPredictions.reduce((acc: number, pred: number, i: number) => 
            acc + (pred === validLabels[i] ? 1 : 0), 0) / validationPredictions.length;
        
        logger.info(`Validation accuracy: ${(accuracy * 100).toFixed(2)}%`);

        if (accuracy < this.MIN_VALIDATION_ACCURACY) {
            const error = `Validation accuracy (${(accuracy * 100).toFixed(2)}%) below threshold (${this.MIN_VALIDATION_ACCURACY * 100}%)`;
            logger.error(error);
            throw new Error(error);
        }

        // Process verify data
        logger.info('Processing verification data...');
        const validIds: string[] = [];
        
        for (const line of verifyLines) {
            const [id, content] = line.split('=').map(s => s.trim());
            const features = this.parseData(content);
            const standardizedFeatures = this.standardize([features], false)[0];  // Use stored parameters

            logger.info(`Verifying ${id} = "${content}" ...`);
            logger.info(`Standardized features: ${standardizedFeatures.join(', ')}\n`);
            
            const prediction = knn.predict([standardizedFeatures])[0];
            if (prediction === 1) {
                validIds.push(id);
            }
            logger.debug(`Classified "${content}" as ${prediction === 1 ? 'correct' : 'incorrect'}`);
        }

        return validIds;
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
const solver = new KNNSolver();
analyzeSamples(solver).catch(console.error);
