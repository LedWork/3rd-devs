import { OpenAIService } from './OpenAIService';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { glob } from 'glob';
import { convert } from 'html-to-markdown';
import { prompts } from '../common/prompts';

const execAsync = promisify(exec);

async function convertToMarkdown(filePath: string): Promise<string> {
  console.log(`Converting file to markdown: ${filePath}`);
  const content = await fs.readFile(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();
  
  let result;
  switch (ext) {
    case '.html':
      throw new Error('HTML processing is currently disabled');
    case '.txt':
    case '.md':
      result = content;
      break;
    default:
      throw new Error(`Unsupported file type: ${ext}`);
  }
  console.log(`Conversion completed for: ${filePath}`);
  return result;
}

async function generateMarkmapSyntax(
  content: string, 
  openAIService: OpenAIService, 
  model: string = "gpt-4o-mini"
): Promise<string> {
  console.log('Generating markmap syntax...');
  const response = await openAIService.completion({
    messages: [
      { role: "system", content: prompts.MARKMAP_GENERATE },
      { role: "user", content }
    ],
    model,
  });

  if (openAIService.isStreamResponse(response)) {
    throw new Error("Unexpected streaming response");
  }

  const result = response.choices[0].message.content || '';
  console.log('Markmap syntax generation completed');
  return result;
}

async function combineMarkmaps(
  markmaps: string[], 
  openAIService: OpenAIService,
  model: string = "gpt-4o-mini"
): Promise<string> {
  const response = await openAIService.completion({
    messages: [
      { role: "system", content: prompts.MARKMAP_COMBINE },
      { role: "user", content: markmaps.join('\n---\n') }
    ],
    model,
  });

  if (openAIService.isStreamResponse(response)) {
    throw new Error("Unexpected streaming response");
  }

  return response.choices[0].message.content || '';
}

async function verifyMarkmap(
  markmap: string, 
  openAIService: OpenAIService,
  model: string = "gpt-4o-mini"
): Promise<string> {
  const response = await openAIService.completion({
    messages: [
      { role: "system", content: prompts.MARKMAP_VERIFY },
      { role: "user", content: markmap }
    ],
    model,
  });

  if (openAIService.isStreamResponse(response)) {
    throw new Error("Unexpected streaming response");
  }

  return response.choices[0].message.content || '';
}

async function main() {
  console.log('Starting mindmap generation process...');
  const dataDir = path.join(__dirname, 'data');
  const outputDir = path.join(__dirname);
  const markmapPath = path.join(outputDir, 'markmap.md');
  const mindmapPath = path.join(outputDir, 'mindmap.html');
  
  console.log(`Data directory: ${dataDir}`);
  console.log(`Output directory: ${outputDir}`);

  const openAIService = new OpenAIService();

  try {
    // Find all supported files recursively (removed html from glob pattern)
    const files = await glob('**/*.{txt,md}', { cwd: dataDir });
    console.log(`Found ${files.length} files to process:`, files);
    
    // Convert files to markdown and generate individual markmaps
    console.log('Processing files...');
    const markmaps = await Promise.all(files.map(async (file) => {
      console.log(`Processing file: ${file}`);
      const filePath = path.join(dataDir, file);
      const markdown = await convertToMarkdown(filePath);
      return generateMarkmapSyntax(markdown, openAIService);
    }));
    console.log(`Generated ${markmaps.length} individual markmaps`);

    // Combine all markmaps
    console.log('Combining markmaps...');
    const combinedMarkmap = await combineMarkmaps(markmaps, openAIService);
    console.log('Markmaps combined successfully');

    // Verify and improve the final markmap
    console.log('Verifying final markmap...');
    const verifiedMarkmap = await verifyMarkmap(combinedMarkmap, openAIService);
    console.log('Markmap verification completed');

    // Extract the map from <final_result> tags
    const finalMarkmap = verifiedMarkmap.match(/<final_result>([\s\S]*?)<\/final_result>/)?.[1] || '';

    // Write final markmap to file
    await fs.writeFile(markmapPath, finalMarkmap);
    console.log(`Markmap written to: ${markmapPath}`);

    // Generate HTML mindmap
    console.log('Generating HTML mindmap...');
    await execAsync(`npx markmap-cli ${markmapPath} -o ${mindmapPath}`);
    console.log(`HTML mindmap generated at: ${mindmapPath}`);

    console.log('Process completed successfully.');
  } catch (error) {
    console.error('Error during mindmap generation:', error);
  }
}

main();