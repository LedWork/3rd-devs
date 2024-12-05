import { OpenAIService } from './OpenAIService';
import { LangfuseService } from './LangfuseService';
import { chat as navigateChat } from '../prompts/drone/navigate';
import { v4 as uuidv4 } from 'uuid';
import type { ChatCompletion, ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export class DroneService {
    private MAP = [
        ['S', 'T', 'D', 'H'], // S=START, T=TRAWA, D=DRZEWO/TRAWA, H=DOM
        ['T', 'W', 'T', 'T'], // W=WIATRAK/TRAWA
        ['T', 'T', 'K', 'L'], // K=SKAŁY, L=TRAWA/DRZEWA
        ['K', 'K', 'A', 'J']  // A=SAMOCHÓD, J=JASKINIA
    ];

    private DESCRIPTIONS: Record<string, string> = {
        'S': 'start',
        'T': 'trawa',
        'D': 'drzewo, trawa',
        'H': 'dom',
        'W': 'wiatrak, trawa',
        'K': 'skały',
        'L': 'trawa, drzewa',
        'A': 'samochód',
        'J': 'jaskinia'
    };

    constructor(
        private openaiService: OpenAIService,
        private langfuseService: LangfuseService
    ) {}

    async processInstruction(instruction: string): Promise<{ description: string } | null> {
        const trace = this.langfuseService.createTrace({
            id: uuidv4(),
            name: 'Drone Navigation',
            sessionId: uuidv4()
        });

        try {
            const messages = navigateChat({ vars: { instruction } }) as ChatCompletionMessageParam[];
            const span = this.langfuseService.createSpan(trace, 'droneNavigation', messages);

            const completion = await this.openaiService.completion({
                messages: messages,
                model: "gpt-4o-mini",
                jsonMode: true
            });

            this.langfuseService.finalizeSpan(span, 'droneNavigation', messages, completion as ChatCompletion);

            if (!('choices' in completion)) {
                return null;
            }

            const response = JSON.parse(
                completion.choices[0].message.content || ""
            );

            // Get correct description based on coordinates
            const [row, col] = response.finalPosition;
            const mapSymbol = this.MAP[row][col];
            const description = this.DESCRIPTIONS[mapSymbol];

            await this.langfuseService.finalizeTrace(trace, messages, [{ role: 'assistant', content: JSON.stringify(description) }]);

            return { description };
        } finally {
            await this.langfuseService.flushAsync();
        }
    }
}

// const droneService = new DroneService(new OpenAIService(), new LangfuseService());
// const result = await droneService.processInstruction('w dół do końca, w prawo do końca, w górę do końca');
// console.log(result);