import { readdir } from 'fs/promises';
import { join } from 'path';
import { createWorker } from 'tesseract.js';
import { OpenAIService } from './OpenAIService';
import { writeFile, readFile } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { TextSplitter } from './TextService';
import type { ChatCompletion } from 'openai/resources/chat/completions.mjs';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.mjs';
import { LangfuseService } from './LangfuseService';
// Reusing the Image type with additional OCR field
type Image = {
    alt: string;
    url: string;
    context: string;
    description: string;
    preview: string;
    base64: string;
    name: string;
    ocrText?: string;
};

// New type for document structure
type ProcessedDocument = {
    id: string;
    fileName: string;
    content: string;
    sections: MarkdownSection[];
    chunks: any[];
    images: Image[];
    metadata: {
        title?: string;
    };
};

type MarkdownSection = {
    level: number;
    title: string;
    content: string;
    subsections: MarkdownSection[];
    description?: string;
};

function parseMarkdownSections(markdown: string): MarkdownSection[] {
    console.log('Starting markdown parsing...');
    
    const lines = markdown.split('\n');
    const rootSections: MarkdownSection[] = [];
    let currentSections: MarkdownSection[] = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const headerMatch = line.match(/^\s*(#{1,6})\s+(.+?)\s*$/);
        
        if (headerMatch?.[1]) {
            const level = headerMatch[1].length;
            const title = headerMatch[2].trim();
            //console.log(`Processing section: ${title}`);
            
            const section: MarkdownSection = {
                level,
                title,
                content: '',
                subsections: []
            };
            
            while (
                currentSections.length > 0 && 
                currentSections[currentSections.length - 1].level >= level
            ) {
                currentSections.pop();
            }
            
            if (currentSections.length === 0) {
                rootSections.push(section);
            } else {
                const parent = currentSections[currentSections.length - 1];
                parent.subsections.push(section);
            }
            
            currentSections.push(section);
        } else {
            // Add content to the current deepest section
            if (currentSections.length > 0) {
                const currentSection = currentSections[currentSections.length - 1];
                currentSection.content += line + '\n';
            }
        }
    }
    
    console.log('Parsing complete.');
    console.log(`Found ${rootSections.length} root sections`);
    
    return rootSections;
}

function flattenSections(sections: MarkdownSection[]): string[] {
    const chunks: string[] = [];
    
    function processSections(section: MarkdownSection) {
        // Create chunk with header and content
        const headerMarker = '#'.repeat(section.level);
        const chunk = `${headerMarker} ${section.title}\n${section.content}`.trim();
        if (chunk) {
            chunks.push(chunk);
        }
        
        // Process subsections
        section.subsections.forEach(processSections);
    }
    
    sections.forEach(processSections);
    return chunks;
}

const openaiService = new OpenAIService();
const langfuseService = new LangfuseService();
const splitter = new TextSplitter();

async function performOCR(imageBuffer: Buffer): Promise<string> {
    const worker = await createWorker();
    await worker.loadLanguage('eng');
    await worker.initialize('eng');
    
    const { data: { text } } = await worker.recognize(imageBuffer);
    await worker.terminate();
    
    return text;
}

// Reusing and modifying the existing image extraction logic
async function extractAndProcessImages(markdown: string, documentPath: string): Promise<Image[]> {
    const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const matches = [...markdown.matchAll(imageRegex)];
    
    const imagePromises = matches.map(async ([, alt, url]) => {
        try {
            const name = url.split('/').pop() || '';
            const imagePath = join(documentPath, '..', url);
            const imageBuffer = await readFile(imagePath);
            const base64 = imageBuffer.toString('base64');
            
            // Perform OCR on the image
            const ocrText = await performOCR(imageBuffer);
            
            // Get image description using OpenAI (reusing existing logic)
            const imageDescription = await getImageDescription(base64);
            
            // Get context using OpenAI
            const context = await getImageContext(markdown, url);
            
            return {
                alt,
                url,
                context,
                description: imageDescription,
                preview: '',
                base64,
                name,
                ocrText
            };
        } catch (error) {
            console.error(`Error processing image ${url}:`, error);
            return null;
        }
    });
    
    const results = await Promise.all(imagePromises);
    return results.filter((link): link is Image => link !== null);
}

async function getImageDescription(base64: string): Promise<string> {
    const userMessage = {
        role: 'user',
        content: [
            {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${base64}` }
            },
            {
                type: "text",
                text: "Describe this image in detail, focusing on both visual elements and potential academic/technical significance."
            }
        ]
    };
    
    const response = await openaiService.completion([userMessage], 'gpt-4-vision-preview');
    return response.choices[0].message.content || '';
}

async function getImageContext(markdown: string, imageUrl: string): Promise<string> {
    const userMessage = {
        role: 'user',
        content: `Analyze this markdown content and provide context for the image ${imageUrl}. What is the surrounding text discussing?\n\n${markdown}`
    };
    
    const response = await openaiService.completion([userMessage], 'gpt-4');
    return response.choices[0].message.content || '';
}

async function processAllMarkdownFiles(markdownFiles: string[], dataDir: string): Promise<ProcessedDocument[]> {
    const processedDocs: ProcessedDocument[] = [];
    
    for (const mdFile of markdownFiles) {
        const mdPath = join(dataDir, mdFile);
        console.log(`Processing ${mdFile}...`);
        
        try {
            // Read markdown directly from file
            const markdown = await readFile(mdPath, 'utf8');
            
            // Parse markdown into sections
            const sections = parseMarkdownSections(markdown);
            //console.log('Sections:', sections);
            const chunks = flattenSections(sections);
            //console.log('Chunks:', chunks);
            // Process each chunk with the text splitter if needed
            const processedChunks = await Promise.all(
                chunks.map(chunk => splitter.split(chunk, 200))
            );
            //console.log('Processed chunks:', processedChunks);
            
            // Extract and process images
            // const images = await extractAndProcessImages(markdown, mdPath);
            const images: Image[] = [];
            
            // Create processed document
            const processedDoc: ProcessedDocument = {
                id: uuidv4(),
                fileName: mdFile,
                content: markdown,
                sections: sections,
                chunks: processedChunks.flat(),
                images,
                metadata: {
                    title: mdFile.replace('.md', '')
                }
            };
            
            processedDocs.push(processedDoc);
            
            // Save processed document to JSON for debugging
            await writeFile(
                join(dataDir, `${mdFile}.json`),
                JSON.stringify(processedDoc, null, 2)
            );
            
        } catch (error) {
            console.error(`Error processing ${mdFile}:`, error);
        }
    }
    
    return processedDocs;
}

async function generateDocumentDescription(trace: Trace, document: ProcessedDocument): Promise<string> {
    const messages: ChatCompletionMessageParam[] = [{
        role: 'system',
        content: `You are an AI assistant specialized in analyzing board game rules and documentation.
        Your task is to generate a concise but informative description of this rules section, focusing on:
        
        1. Game Mechanics:
           - Core gameplay elements
           - Key rules or mechanisms
           - Player interactions
        
        2. Rules Structure:
           - Phase or turn sequence
           - Special conditions
           - Important exceptions
        
        3. Gameplay Impact:
           - Strategic implications
           - Player experience
           - How it connects to other rules
        
        Generate a clear, objective description in 2-3 sentences.
        
        Example Output:
        <description>
        This section details the resource gathering phase of the game, where players collect wood, stone, and gold from their controlled territories. The mechanics involve rolling dice to determine harvest yields, with bonuses applied based on building improvements and character abilities. These resources form the foundation of the game's economy, enabling players to construct buildings and recruit units in later phases.
        </description>
        
        <context>
        ${document.content}
        </context>
        `
    }, {
        role: 'user',
        content: `Analyze and describe this document:\n\n${document.content}`
    }];

    const span = langfuseService.createSpan(trace, 'generate_document_description');
    const response = await openaiService.completion(messages, 'gpt-4') as ChatCompletion;
    await langfuseService.finalizeSpan(span, 'generate_document_description', messages, response);
    const content = response.choices[0].message.content || '';

    // Extract content between <description> tags
    const match = content.match(/<description>(.*?)<\/description>/s);
    const description = match ? match[1].trim() : '';

    return description;
}

// Main execution
async function main() {
    try {
        const dataDir = join(__dirname, 'data');
        const files = await readdir(dataDir);
        const markdownFiles = files.filter(file => file.endsWith('.md'));

        const processedDocs = await processAllMarkdownFiles(markdownFiles, dataDir);
        console.log(`Processed ${processedDocs.length} documents`);

        const trace = langfuseService.createTrace({
            id: uuidv4(),
            name: 'Document Description',
            sessionId: uuidv4()
        });

        for (const document of processedDocs) {
            // for each section, generate description
            for (const section of document.sections) {
                const description = await generateDocumentDescription(trace, document, section);
                console.log(`Generated description for ${section.title}: ${description}`);
                // add description to markdown sections
                section.description = description;
            }
            // generate for each subsection recursively
            for (const subsection of section.subsections) {
                const description = await generateDocumentDescription(trace, document, subsection);
                console.log(`Generated description for ${subsection.title}: ${description}`);
                // add description to markdown sections
                subsection.description = description;
            }
        }
        
        // Here you would add code to save to your vector database
        // Example: await vectorDb.saveDocuments(processedDocs);
        
    } catch (error) {
        console.error('Error in main execution:', error);
    }
}
main().catch(console.error);
