import fetch from 'node-fetch';
import { OpenAIService } from './OpenAIService';
import type { ChatCompletion, ChatCompletionMessageParam } from 'openai/resources/chat/completions.mjs';
import { LangfuseService } from './LangfuseService';
import { v4 as uuidv4 } from 'uuid';

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

async function getTableStructure(tableName: string): Promise<string> {
    const response = await queryDatabase(`show create table ${tableName}`);
    return response.reply[0]['Create Table'];
}

const openAiService = new OpenAIService();
const langfuseService = new LangfuseService();

async function main() {
    const trace = langfuseService.createTrace({
        id: uuidv4(),
        name: 'Database Query',
        sessionId: uuidv4()
    });

    try {
        // 1. Get list of tables
        console.log('Getting list of tables...');
        const tablesResponse = await queryDatabase('show tables');
        const tables = tablesResponse.reply.map(row => row['Tables_in_banan']);
        console.log('Available tables:', tables);

        // 2. Get structure of relevant tables
        console.log('\nGetting table structures...');
        const tableStructures = [];
        for (const table of tables) {
            const tableStructure = await getTableStructure(table);
            // console.log(`Table structure for ${table}:`, tableStructure);
            tableStructures.push(tableStructure);
        }
        console.log('Table structures retrieved');

        // 3. Send the table structures to the AI Assistant
        const tableStructuresString = tableStructures.join('\n');
        const userQueryForSql = "Get the list of datacenter IDs where the manager is inactive and the datacenter is active";
        const messages : ChatCompletionMessageParam[] = [
            { role: 'system', content: `
            <context>
            ${tableStructuresString}
            </context>

            You are an expert SQL query builder. 
            You are given a list of table structures and you need to build a query that will return the desired data requested by the user.
            Return only the query, without any additional text.
            `},
            { role: 'user', content: `${userQueryForSql}` }
        ];
        const span = langfuseService.createSpan(trace, 'build_query', messages);
        const result = await openAiService.completion(messages, "gpt-4o-mini") as ChatCompletion;
        await langfuseService.finalizeSpan(span, 'build_query', messages, result);
        const queryResult = (result.choices[0].message.content || '').replace('```sql', '').replace('```', '');

        console.log('Result:', queryResult);

        // 4. Verify that query is valid and will return the proper data
        const messagesForValidation : ChatCompletionMessageParam[] = [
            { role: 'system', content: `
            <context>
            ${tableStructuresString}
            </context>

            You are an expert SQL query validator.
            In the provided context you have the table structures of a database.
            You are given a query by the user and you need to verify that it is valid and will return the proper data from the database.
            Return "VALID" if the query is valid, otherwise return "INVALID".
            Do not return any additional text.
            `},
            { role: 'user', content: `${queryResult}` }
        ];
        const spanForValidation = langfuseService.createSpan(trace, 'validate_query', messagesForValidation);
        const resultOfValidation = await openAiService.completion(messagesForValidation, "gpt-4o-mini") as ChatCompletion;
        await langfuseService.finalizeSpan(spanForValidation, 'validate_query', messagesForValidation, resultOfValidation);
        console.log('Query validation result:', resultOfValidation.choices[0].message.content || '');

        const isValid = (resultOfValidation.choices[0].message.content || '').toUpperCase() === 'VALID';
        console.log('Query is valid:', isValid);

        if (!isValid) {
            throw new Error('Invalid query');
        }

        // 5. Execute the query
        console.log('\nExecuting main query...');
        const resultOfQueryFromDb = await queryDatabase(queryResult);
        console.log('Query execution result:', resultOfQueryFromDb.reply);

        const dcIds = resultOfQueryFromDb.reply.map((row: any) => row.dc_id);
        console.log('Found datacenter IDs:', dcIds);

        await langfuseService.finalizeTrace(trace, [...messages, ...messagesForValidation], [result.choices[0].message, resultOfValidation.choices[0].message]);

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
        await langfuseService.shutdownAsync();
    }
}

main().catch(console.error);
