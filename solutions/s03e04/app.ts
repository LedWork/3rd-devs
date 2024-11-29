import fetch from 'node-fetch';
import { OpenAIService } from './OpenAIService';
import type { ChatCompletion, ChatCompletionMessageParam } from 'openai/resources/chat/completions.mjs';
import { LangfuseService } from './LangfuseService';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { logger } from '../common/logger';

const openAiService = new OpenAIService();
const langfuseService = new LangfuseService();

const danePath = path.join(__dirname, 'data', 'barbara.txt');
const peoplePath = path.join(__dirname, 'data', 'people.json');
const placesPath = path.join(__dirname, 'data', 'places.json');
const resultPath = path.join(__dirname, 'data', 'result.json');


const trace = langfuseService.createTrace({
    id: uuidv4(),
    name: 'Loop Search',
    sessionId: uuidv4()
});

interface ApiResponse {
    code: number;
    message: string;
}

interface SearchResult {
    places: Map<string, string[]>;
    people: Map<string, string[]>;
    requested: Set<string>;
}

async function fetchData(url: string, query: string): Promise<ApiResponse> {
    const apiKey = process.env.AI_DEVS_API_KEY;
    if (!apiKey) {
        throw new Error('AI_DEVS_API_KEY is not set');
    }

    logger.debug(`Fetching data from ${url} with query: ${query}`);
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            apikey: apiKey,
            query: query
        })
    });

    if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
    }

    const data = await response.json() as ApiResponse;

    // Check if response contains restricted data
    if (data.message === '[**RESTRICTED DATA**]') {
        return {
            code: data.code,
            message: ''
        };
    }

    // check if response contains URL, if yes, log it but return empty message
    if (data.message.startsWith('http')) {
        logger.url(data.message);
        return {
            code: data.code,
            message: ''
        };
    }

    return data;
}

async function searchPeople(name: string): Promise<string[]> {
    const response = await fetchData('https://centrala.ag3nts.org/people', name);
    return response.message.split(' ').filter(Boolean);
}

async function searchPlaces(place: string): Promise<string[]> {
    const response = await fetchData('https://centrala.ag3nts.org/places', place);
    return response.message.split(' ').filter(Boolean);
}

async function fetchBarbaraData(): Promise<string> {
    const response = await fetch('https://centrala.ag3nts.org/dane/barbara.txt');
    if (!response.ok) {
        throw new Error('Failed to fetch Barbara data');
    }
    return await response.text();
}

function removeDiacritics(str: string): string {
    return str.normalize('NFD')
        .replace(/[\u0142]/g, 'l')  // special case for ł
        .replace(/[\u0141]/g, 'L')  // special case for Ł
        .replace(/[\u0105]/g, 'a')  // special case for ą
        .replace(/[\u0104]/g, 'A')  // special case for Ą
        .replace(/[\u0119]/g, 'e')  // special case for ę
        .replace(/[\u0118]/g, 'E')  // special case for Ę
        .replace(/[\u00F3]/g, 'o')  // special case for ó
        .replace(/[\u00D3]/g, 'O')  // special case for Ó
        .replace(/\p{Diacritic}/gu, '');
}

async function normalizeEntities(
    entities: string[],
    isPlace: boolean
): Promise<string[]> {
    const normalizeMessages: ChatCompletionMessageParam[] = [
        {
            role: 'system',
            content: `Convert the following ${isPlace ? 'place names' : 'person names'} to uppercase, remove Polish diacritic signs and special characters, and convert to nominative case.
            The output can be misspelled - in that case, return the correct version, basing your response on your knowledge of the Polish cities and names.
            Return as a space-separated list of strings, without any other characters.

Examples:
${isPlace
                    ? `
- "Krakowie" -> "KRAKOW"
- "Wrocłaia" -> "WROCLAW"
- "Gdańsku" -> "GDANSK"
- "Grudziadz" -> "GRUDZIADZ"
- "Łodzi" -> "LODZ"`
                    : `
- "Rafał" -> "RAFAŁ"
- "Małgorzatą" -> "MALGORZATA"
- "Małgorztą" -> "MALGORZATA"
- "Piotrem Nowakiem" -> "PIOTR"
- "Anią" -> "ANNA"
- "Tomkowi" -> "TOMEK"`
                }`
        },
        { role: 'user', content: entities.join(' ') }
    ];

    logger.info(`Normalizing ${isPlace ? 'places' : 'people'}: ${entities.join(' ')}`);
    const normalizeSpan = langfuseService.createSpan(trace, 'normalize_entities', normalizeMessages);
    const normalizedResults = await openAiService.completion(normalizeMessages, "gpt-4o-mini") as ChatCompletion;
    await langfuseService.finalizeSpan(normalizeSpan, 'normalize_entities', normalizeMessages, normalizedResults);

    return normalizedResults.choices[0].message.content?.trim()
        ?.split(' ')
        .map(word => removeDiacritics(word).toUpperCase())
        .filter(Boolean) || [];
}

async function processEntitySearch(
    entity: string,
    result: SearchResult,
    isPlace: boolean
): Promise<void> {
    logger.processing(`${isPlace ? 'Place' : 'Person'}: ${entity}`);
    entity = removeDiacritics(entity).toUpperCase();

    if (result.requested.has(entity)) {
        logger.debug(`Already processed: ${entity}`);
        return;
    }

    result.requested.add(entity);
    logger.info(`Searching for ${isPlace ? 'people in' : 'places visited by'} ${entity}`);

    const searchResults = isPlace ?
        await searchPlaces(entity) :
        await searchPeople(entity);

    // Normalize the search results only if the array is not empty
    const normalizedResults = searchResults.length > 0 ?
        await normalizeEntities(searchResults, !isPlace) : [];
    logger.success(`Normalized results for ${entity}: ${normalizedResults}`);

    if (isPlace) {
        if (!result.places.has(entity)) {
            result.places.set(entity, []);
            logger.debug(`Created new place entry for ${entity}`);
        }

        for (const person of normalizedResults) {
            if (!result.places.get(entity)?.includes(person)) {
                result.places.get(entity)?.push(person);
                logger.success(`Added person ${person} to place ${entity}`);
            }
        }
    } else {
        if (!result.people.has(entity)) {
            result.people.set(entity, []);
            logger.debug(`Created new person entry for ${entity}`);
        }
        for (const place of normalizedResults) {
            if (!result.people.get(entity)?.includes(place)) {
                result.people.get(entity)?.push(place);
                logger.success(`Added place ${place} to person ${entity}`);
            }
        }
    }

    // Process new entities with normalized values
    logger.info(`Processing ${normalizedResults.length} new entities from ${entity}`);
    for (const newEntity of normalizedResults) {
        await processEntitySearch(newEntity, result, !isPlace);
    }
}

async function extractEntities(
    barbaraText: string,
    openAiService: OpenAIService,
    langfuseService: LangfuseService,
    trace: any
): Promise<{ people: string[], places: string[] }> {
    const extractionMessages: ChatCompletionMessageParam[] = [
        {
            role: 'system',
            content: `Extract all people names and place names from the text. 
Return them in JSON format with two arrays: "people" and "places". 
Return everything in upper case. 
Return everything in nominative form, without any special characters (eg. without Polish diacritic signs).
While transforming names, keep the context of the text to make sure the gender is correct.
If name and surname are provided, return only the name.

Examples of transformations:

Input names -> Output names
People:
- "Małgorzatą Kowalską" -> "MALGORZATA"
- "Piotrem Nowakiem" -> "PIOTR"
- "Anią Wiśniewską" -> "ANNA"
- "Tomkowi Zielińskiemu" -> "TOMASZ"

Places:
- "w Krakowie" -> "KRAKOW"
- "do Wrocławia" -> "WROCLAW"
- "przez Gdańsk" -> "GDANSK"
- "w Łodzi" -> "LODZ"

Return format:
{
    "people": ["PERSON1", "PERSON2"],
    "places": ["PLACE1", "PLACE2"]
}`
        },
        { role: 'user', content: barbaraText }
    ];

    const extractionSpan = langfuseService.createSpan(trace, 'extract_entities', extractionMessages);
    const extractionResult = await openAiService.completion(extractionMessages, "gpt-4o-mini", false, true) as ChatCompletion;
    await langfuseService.finalizeSpan(extractionSpan, 'extract_entities', extractionMessages, extractionResult);

    return JSON.parse(extractionResult.choices[0].message.content || '{}');
}

async function findBarbaraLocation(
    result: SearchResult
): Promise<string[]> {
    // Find all cities where Barbara is present
    const barbaraCities: string[] = [];

    // Search through the places map
    for (const [city, people] of Object.entries(result.places)) {
        if (people.includes('BARBARA')) {
            barbaraCities.push(city);
        }
    }

    // If multiple cities found, join them with comma
    return barbaraCities;
}

async function main() {
    const openAiService = new OpenAIService();
    const langfuseService = new LangfuseService();

    // Initialize result object
    const result: SearchResult = {
        places: new Map(),
        people: new Map(),
        requested: new Set()
    };

    try {
        // 1. Fetch Barbara's data if file does not exist
        if (!fs.existsSync(danePath)) {
            const barbaraText = await fetchBarbaraData();
            fs.writeFileSync(danePath, barbaraText);
        }
        const barbaraText = fs.readFileSync(danePath, 'utf8');

        // 2. Extract entities using AI
        if (!fs.existsSync(peoplePath) || !fs.existsSync(placesPath)) {
            const entities = await extractEntities(barbaraText, openAiService, langfuseService, trace);
            fs.writeFileSync(peoplePath, JSON.stringify(entities.people));
            fs.writeFileSync(placesPath, JSON.stringify(entities.places));
        }

        const entities = {
            people: JSON.parse(fs.readFileSync(peoplePath, 'utf8')),
            places: JSON.parse(fs.readFileSync(placesPath, 'utf8'))
        };

        // 3. Process all entities
        if (!fs.existsSync(resultPath)) {
            try {
                for (const person of entities.people) {
                    await processEntitySearch(person, result, false);
                }

                for (const place of entities.places) {
                    await processEntitySearch(place, result, true);
                }

            } catch (error) {
                logger.error('Error during processing:', error);
            } finally {
                try {
                    // Always try to save results, even if there was an error
                    fs.writeFileSync(resultPath, JSON.stringify(
                        {
                            places: Object.fromEntries(result.places),
                            people: Object.fromEntries(result.people),
                            requested: Array.from(result.requested)
                        },
                        null,
                        2
                    ));
                    logger.success('Results saved successfully');
                } catch (saveError) {
                    logger.error('Error saving results:', saveError);
                }
            }
        }

        // 4. Find Barbara's location
        const results = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
        const locations = await findBarbaraLocation(results);
        logger.success(`Locations: ${locations}`);

        // 5. Report the result
        // for each location, report the result
        for (const location of locations) {
            const response = await fetch('https://centrala.ag3nts.org/report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    task: 'loop',
                    apikey: process.env.AI_DEVS_API_KEY,
                    answer: location
                })
            });

            const apiResponse = await response.json();
            logger.info(`API Response: ${JSON.stringify(apiResponse)}`);
        }
    } catch (error) {
        logger.error('Error during execution:', error);
    } finally {
        await langfuseService.flushAsync();
        await langfuseService.shutdownAsync();
    }
}

main().catch(console.error);
