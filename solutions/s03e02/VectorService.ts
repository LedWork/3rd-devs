import { QdrantClient } from '@qdrant/js-client-rest';
import { OpenAIService } from './OpenAIService';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';

export class VectorService {
    private client: QdrantClient;
    private openAIService: OpenAIService;

    constructor(openAIService: OpenAIService) {
        this.client = new QdrantClient({
            url: process.env.QDRANT_URL,
            apiKey: process.env.QDRANT_API_KEY,
        });
        this.openAIService = openAIService;
    }

    async ensureCollection(name: string) {
        console.log('Checking for existing collection...');
        const collections = await this.client.getCollections();
        if (!collections.collections.some(c => c.name === name)) {
            console.log('Creating new collection...');
            await this.client.createCollection(name, {
                vectors: { 
                    size: 1536, // text-embedding-3-small dimension size
                    distance: "Cosine" 
                }
            });
            console.log('Collection created successfully');
        } else {
            console.log('Collection already exists');
        }
    }

    async addPoints(
        collectionName: string, 
        points: Array<{
            id: string;
            text: string;
            metadata?: Record<string, any>;
        }>
    ) {
        try {
            console.log('Creating embeddings for points...');
            const pointsToUpsert = await Promise.all(
                points.map(async (point) => {
                    try {
                        const embedding = await this.openAIService.createEmbedding(point.text);
                        console.log(`Created embedding for ${point.id} of size ${embedding.length}`);
                        return {
                            id: point.id || uuidv4(),
                            vector: embedding,
                            payload: {
                                text: point.text,
                                ...point.metadata
                            },
                        };
                    } catch (error) {
                        console.error(`Error creating embedding for ${point.id}:`, error);
                        throw error;
                    }
                })
            );

            const pointsFilePath = path.join(__dirname, "points.json");
            await fs.writeFile(pointsFilePath, JSON.stringify(pointsToUpsert, null, 2));

            console.log('Upserting points to Qdrant...');
            await this.client.upsert(collectionName, {
                wait: true,
                points: pointsToUpsert
            });
            console.log('Points upserted successfully');
        } catch (error) {
            console.error('Error in addPoints:', error);
            throw error;
        }
    }

    async performSearch(collectionName: string, query: string, limit: number = 5) {
        try {
            console.log('Creating embedding for search query...');
            const queryEmbedding = await this.openAIService.createEmbedding(query);
            
            console.log('Performing vector search...');
            const results = await this.client.search(collectionName, {
                vector: queryEmbedding,
                limit,
                with_payload: true,
            });
            
            console.log(`Found ${results.length} results`);
            return results;
        } catch (error) {
            console.error('Error in performSearch:', error);
            throw error;
        }
    }
} 