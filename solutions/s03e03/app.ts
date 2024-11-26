import fetch from 'node-fetch';
import { OpenAIService } from './OpenAIService';
import type { ChatCompletion, ChatCompletionMessageParam } from 'openai/resources/chat/completions.mjs';
import { LangfuseService } from './LangfuseService';
import { v4 as uuidv4 } from 'uuid';

const openAiService = new OpenAIService();
const langfuseService = new LangfuseService();

interface DatabaseResponse {
    reply: any[];
    error: string;
}

async function queryDatabase(query: string): Promise<DatabaseResponse> {
    const apiKey = process.env.AI_DEVS_API_KEY;
    if (!apiKey) {
        throw new Error('AI_DEVS_API_KEY is not set');
    }

    const response = await fetch('https://centrala.ag3nts.org/apidb', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            task: 'database',
            apikey: apiKey,
            query: query
        })
    });

    if (!response.ok) {
        throw new Error(`Database API error: ${response.statusText}`);
    }

    const data = await response.json() as DatabaseResponse;
    if (data.error !== 'OK') {
        throw new Error(`Database query error: ${data.error}`);
    }

    return data;
}

async function exploreDatabase(userQueryForSql: string, trace: any): Promise<[string, string[]]> {
    const messages: ChatCompletionMessageParam[] = [
        { role: 'system', content: `
        You are an expert SQL database explorer. You need to explore the database structure before building a query.
        You have access to these commands:
        - 'show tables' - returns list of all tables
        - 'show create table TABLE_NAME' - shows table structure
        
        Return an array of exploration queries that will help you understand the database structure.
        Format your response as a single string, for example:
        Example 1:
        show tables
        Example 2:
        show create table users
        Example 3:
        show create table orders
        
        Return only one command to execute at a time, no additional text.
        Remember, that at the beginning, you don't know the names of the tables, so you need to explore the database structure first.
        When you are done, respond with the final query that will return the user's desired data in <final_query> tag.` },
        { role: 'user', content: userQueryForSql }
    ];

    let finalQuery = '';
    const tableStructures: string[] = [];

    while (true) {
        const span = langfuseService.createSpan(trace, 'explore_database', messages);
        const result = await openAiService.completion(messages, "gpt-4o-mini") as ChatCompletion;
        await langfuseService.finalizeSpan(span, 'explore_database', messages, result);

        const explorationQuery = result.choices[0].message.content || '';

        if (explorationQuery.length === 0) {
            console.log('No exploration queries found');
            break;
        }
        
        if (explorationQuery.includes('<final_query>')) {
            finalQuery = explorationQuery.match(/<final_query>(.*?)<\/final_query>/)?.[1] || '';
            console.log('Final query found: ', finalQuery);
            break;
        }

        messages.push({ role: 'assistant', content: explorationQuery });
        console.log(`Executing exploration query: ${explorationQuery}`);

        const response = await queryDatabase(explorationQuery);
        messages.push({ role: 'user', content: JSON.stringify(response.reply) });
        tableStructures.push(JSON.stringify(response.reply));
    }

    return [finalQuery, tableStructures];
}

async function main() {
    const trace = langfuseService.createTrace({
        id: uuidv4(),
        name: 'Database Query',
        sessionId: uuidv4()
    });

    try {
        const userQueryForSql = "Get the list of datacenter IDs where the manager is inactive and the datacenter is active";

        // Automatically explore database structure
        console.log('\nExploring database structure...');
        const [finalQuery, tableStructures] = await exploreDatabase(userQueryForSql, trace);
        const finalQueryParsed = finalQuery.replace('```sql', '').replace('```', '');
        console.log('Final query retrieved: ', finalQueryParsed);

        // 4. Verify that query is valid and will return the proper data
        const messagesForValidation : ChatCompletionMessageParam[] = [
            { role: 'system', content: `
            <context>
            ${tableStructures.join('\n')}
            </context>

            You are an expert SQL query validator.
            In the provided context you have the table structures of a database.
            You are given a query by the user and you need to verify that it is valid and will return the proper data from the database.
            Return "VALID" if the query is valid, otherwise return "INVALID".
            Do not return any additional text.
            `},
            { role: 'user', content: `${finalQueryParsed}` }
        ];
        const spanForValidation = langfuseService.createSpan(trace, 'validate_query', messagesForValidation);
        const resultOfValidation = await openAiService.completion(messagesForValidation, "gpt-4o-mini") as ChatCompletion;
        await langfuseService.finalizeSpan(spanForValidation, 'validate_query', messagesForValidation, resultOfValidation);
        console.log('Query validation result:', resultOfValidation.choices[0].message.content || '');

        await langfuseService.finalizeTrace(trace, messagesForValidation, [resultOfValidation.choices[0].message]);

        const isValid = (resultOfValidation.choices[0].message.content || '').toUpperCase() === 'VALID';
        console.log('Query is valid:', isValid);

        if (!isValid) {
            throw new Error('Invalid query');
        }

        // 5. Execute the query
        console.log('\nExecuting main query...');
        const resultOfQueryFromDb = await queryDatabase(finalQueryParsed);
        console.log('Query execution result:', resultOfQueryFromDb.reply);

        const dcIds = resultOfQueryFromDb.reply.map((row: any) => row.dc_id);
        console.log('Found datacenter IDs:', dcIds);

        // 6. Send the answer to the API
        console.log('\nSending result to API...');
        const response = await fetch('https://centrala.ag3nts.org/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                task: 'database',
                apikey: process.env.AI_DEVS_API_KEY,
                answer: dcIds
            })
        });

        const apiResponse = await response.json();
        console.log('API Response:', apiResponse);

    } catch (error) {
        console.error('Error:', error);
        throw error;
    } finally {
        await langfuseService.flushAsync();
        await langfuseService.shutdownAsync();
    }
}

main().catch(console.error);
