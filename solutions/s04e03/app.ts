import { SoftoService } from './services/SoftoService';
import { logger } from '../common/logger';

async function processSofto() {
  try {
    const apiKey = process.env.AI_DEVS_API_KEY;
    if (!apiKey) {
      throw new Error('AI_DEVS_API_KEY not found in environment variables');
    }

    const softoService = new SoftoService();

    // Fetch and save questions
    const questions = await softoService.fetchQuestions(apiKey);
    logger.info('Questions:', questions);

    // Find answers
    const answers = await softoService.findAnswers(questions);
    logger.info('Answers:', answers);

    const response = await fetch('https://centrala.ag3nts.org/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'softo',
        apikey: apiKey,
        answer: answers
      })
    });

    const result = await response.json();
    logger.info('Submission result:', result);

    logger.info('Softo processing completed successfully');
    return { success: true, answers };
  } catch (error: any) {
    console.error('Error in processSofto:', error);
    throw error;
  }
}

processSofto().catch(console.error);
