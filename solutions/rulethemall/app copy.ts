import { readdir } from 'fs/promises';
import { join } from 'path';
import pdf2md from '@opendocsg/pdf2md';
import { createWorker } from 'tesseract.js';
import { OpenAIService } from './OpenAIService';
import { writeFile, readFile } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { pdfToMarkdown } from './pdfToMarkdown';

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
    images: Image[];
    metadata: {
        title?: string;
        author?: string;
        date?: string;
    };
};

const openaiService = new OpenAIService();

async function convertPdfToMarkdown(pdfPath: string): Promise<string> {
    try {
        const outputPath = `${pdfPath}.md`;
        await pdfToMarkdown(pdfPath, outputPath, {
            useOCR: true,
            preserveFormatting: true
        });
        return fs.readFileSync(outputPath, 'utf8');
    } catch (error) {
        console.error(`Error converting PDF to markdown: ${error}`);
        throw error;
    }
}

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

async function processAllPdfs(): Promise<ProcessedDocument[]> {
    const dataDir = join(__dirname, 'data');
    const files = await readdir(dataDir);
    const pdfFiles = files.filter(file => file.endsWith('.pdf'));
    
    const processedDocs: ProcessedDocument[] = [];
    
    for (const pdfFile of pdfFiles) {
        const pdfPath = join(dataDir, pdfFile);
        console.log(`Processing ${pdfFile}...`);
        
        try {
            // Convert PDF to markdown
            const markdown = await convertPdfToMarkdown(pdfPath);
            // save to file
            await writeFile(join(dataDir, `${pdfFile}.md`), markdown);
            
            // // Extract and process images
            // const images = await extractAndProcessImages(markdown, pdfPath);
            
            // // Create processed document
            // const processedDoc: ProcessedDocument = {
            //     id: uuidv4(),
            //     fileName: pdfFile,
            //     content: markdown,
            //     images,
            //     metadata: {
            //         title: pdfFile.replace('.pdf', ''),
            //         date: new Date().toISOString()
            //     }
            // };
            
            // processedDocs.push(processedDoc);
            
            // // Save processed document to JSON for debugging
            // await writeFile(
            //     join(dataDir, `${pdfFile}.json`),
            //     JSON.stringify(processedDoc, null, 2)
            // );
            
        } catch (error) {
            console.error(`Error processing ${pdfFile}:`, error);
        }
    }
    
    return processedDocs;
}

// Main execution
async function main() {
    try {
        const processedDocs = await processAllPdfs();
        console.log(`Processed ${processedDocs.length} documents`);
        
        // Here you would add code to save to your vector database
        // Example: await vectorDb.saveDocuments(processedDocs);
        
    } catch (error) {
        console.error('Error in main execution:', error);
    }
}
main().catch(console.error);
