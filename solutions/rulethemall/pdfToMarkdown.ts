import fs from 'fs';
import { PDFDocument } from 'pdf-lib';
import TurndownService from 'turndown';
import { createWorker } from 'tesseract.js';

interface PDFProcessingOptions {
  useOCR?: boolean;
  preserveFormatting?: boolean;
  maxPages?: number;
}

async function extractTextFromPDF(pdfPath: string, options: PDFProcessingOptions = {}): Promise<string> {
  try {
    const pdfBuffer = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const pages = pdfDoc.getPages();
    const textContent: string[] = [];
    
    // Respect max pages limit if set
    const pageLimit = options.maxPages || pages.length;
    
    for (let i = 0; i < Math.min(pages.length, pageLimit); i++) {
      const page = pages[i];
      let pageText = '';
      
      try {
        const text = await page.getTextContent();
        pageText = text.items.map(item => item.str).join(' ');
        
        // If text extraction fails or returns empty and OCR is enabled
        if ((!pageText || pageText.trim().length === 0) && options.useOCR) {
          const imageBytes = await page.render().toBuffer();
          const worker = await createWorker();
          await worker.loadLanguage('eng');
          await worker.initialize('eng');
          const { data: { text: ocrText } } = await worker.recognize(imageBytes);
          await worker.terminate();
          pageText = ocrText;
        }
        
        textContent.push(pageText);
      } catch (error) {
        console.error(`Error processing page ${i + 1}:`, error);
        textContent.push(`[Error processing page ${i + 1}]`);
      }
    }
    
    return textContent.join('\n\n');
  } catch (error) {
    throw new Error(`Failed to extract text from PDF: ${error.message}`);
  }
}

function convertToMarkdown(text: string, options: PDFProcessingOptions = {}): string {
  const turndownService = new TurndownService({
    headingStyle: 'atx'
  });

  return turndownService.turndown(text);
}

export { extractTextFromPDF, convertToMarkdown }; 