import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { OpenAIService } from './OpenAIService';
import { LangfuseService } from './LangfuseService';
import { logger } from '../common/logger';
import type { ChatCompletion } from 'openai/resources/chat/completions.mjs';
import { metaPrompt } from './prompts';

const app = express();
app.use(express.json());

const openAiService = new OpenAIService();
const langfuseService = new LangfuseService();
const conversationDir = path.join(__dirname, 'data');

const traceId = uuidv4();

app.post('/api/chat', async (req, res) => {
    const { conversation_uuid = uuidv4(), messages } = req.body;
    const conversationPath = path.join(conversationDir, `conversation_${conversation_uuid}.json`);

    const trace = langfuseService.createTrace({
        id: traceId,
        name: 'Meta Prompt',
        sessionId: conversation_uuid
    });

    let conversationHistory = [];
    if (fs.existsSync(conversationPath)) {
        conversationHistory = JSON.parse(fs.readFileSync(conversationPath, 'utf8'));
    }

    conversationHistory.push(...messages);

    const systemPrompt = metaPrompt();

    const conversation = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory
    ];
    const span = langfuseService.createSpan(trace, 'meta_prompt', conversation);
    const aiResponse = await openAiService.completion(conversation) as ChatCompletion;
    await langfuseService.finalizeSpan(span, 'meta_prompt', conversation, aiResponse);

    const response = aiResponse.choices[0].message.content;
    conversationHistory.push({ role: 'assistant', content: response });

    fs.writeFileSync(conversationPath, JSON.stringify(conversationHistory, null, 2));

    res.json({ conversation_uuid: conversation_uuid, response });
});

app.listen(3000, () => {
    logger.info('Server is running on port 3000');
});
