import express from 'express';
import { OpenAIService } from './services/OpenAIService';
import { LangfuseService } from './services/LangfuseService';
import { DroneService } from './services/DroneService';
import { logger } from '../common/logger';

const app = express();
app.use(express.json());

const openaiService = new OpenAIService();
const langfuseService = new LangfuseService();
const droneService = new DroneService(openaiService, langfuseService);

app.post('/api/drone', async (req, res) => {
    try {
        const { instruction } = req.body;

        if (!instruction) {
            return res.status(400).json({ error: 'Missing instruction in request body' });
        }
        logger.info('Processing instruction:', instruction);

        const result = await droneService.processInstruction(instruction);
        
        if (!result) {
            return res.status(500).json({ error: 'Failed to process instruction' });
        }

        logger.info('Result:', result);
        logger.info('--------------------------------');

        return res.json(result);
    } catch (error) {
        console.error('Error processing drone instruction:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Remove duplicate listen call
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// Cleanup on server shutdown
process.on('SIGTERM', async () => {
    await langfuseService.shutdownAsync();
    process.exit(0);
});
