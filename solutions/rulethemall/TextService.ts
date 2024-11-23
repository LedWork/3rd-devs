import { createByModelName } from '@microsoft/tiktokenizer';

interface IDoc {
  text: string;
  metadata: {
    tokens: number;
    headers: Headers;
    urls: string[];
    images: string[];
  };
}

interface Headers {
  [key: string]: string[];
}

export class TextSplitter {
  private tokenizer?: Awaited<ReturnType<typeof createByModelName>>;

  private readonly MODEL_NAME: string;
  private readonly SPECIAL_TOKENS = new Map<string, number>([
    ['<|im_start|>', 100264],
    ['<|im_end|>', 100265],
    ['<|im_sep|>', 100266],
  ]);

  constructor(modelName: string = 'gpt-4o') {
    this.MODEL_NAME = modelName;
  }

  private async initializeTokenizer(): Promise<void> {
    if (!this.tokenizer) {
      this.tokenizer = await createByModelName(this.MODEL_NAME, this.SPECIAL_TOKENS);
    }
  }

  private countTokens(text: string): number {
    if (!this.tokenizer) {
      throw new Error('Tokenizer not initialized');
    }
    const formattedContent = this.formatForTokenization(text);
    const tokens = this.tokenizer.encode(formattedContent, Array.from(this.SPECIAL_TOKENS.keys()));
    return tokens.length;
  }

  private formatForTokenization(text: string): string {
    return `<|im_start|>user\n${text}<|im_end|>\n<|im_start|>assistant<|im_end|>`;
  }

  async split(text: string, limit: number): Promise<IDoc[]> {
    console.log(`Starting split process with limit: ${limit} tokens`);
    await this.initializeTokenizer();
    const chunks: IDoc[] = [];
    let position = 0;
    const totalLength = text.length;
    const currentHeaders: Headers = {};

    while (position < totalLength) {
      const { chunkText, chunkEnd } = this.getChunk(text, position, limit);
      const tokens = this.countTokens(chunkText);

      const headersInChunk = this.extractHeaders(chunkText);
      this.updateCurrentHeaders(currentHeaders, headersInChunk);

      const { content, urls, images } = this.extractUrlsAndImages(chunkText);

      chunks.push({
        text: content,
        metadata: {
          tokens,
          headers: { ...currentHeaders },
          urls,
          images,
        },
      });

      position = chunkEnd;
    }

    console.log(`Split process completed. Total chunks: ${chunks.length}`);
    return chunks;
  }

  private getChunk(text: string, start: number, limit: number): { chunkText: string; chunkEnd: number } {
    const overhead = this.countTokens(this.formatForTokenization('')) - this.countTokens('');
    
    let end = Math.min(start + Math.floor((text.length - start) * limit / this.countTokens(text.slice(start))), text.length);
    
    let chunkText = text.slice(start, end);
    let tokens = this.countTokens(chunkText);
    
    while (tokens + overhead > limit && end > start) {
      end = this.findNewChunkEnd(text, start, end);
      chunkText = text.slice(start, end);
      tokens = this.countTokens(chunkText);
    }

    end = this.adjustChunkEnd(text, start, end, tokens + overhead, limit);

    chunkText = text.slice(start, end);
    tokens = this.countTokens(chunkText);
    return { chunkText, chunkEnd: end };
  }

  private adjustChunkEnd(text: string, start: number, end: number, currentTokens: number, limit: number): number {
    const minChunkTokens = limit * 0.8;

    const nextNewline = text.indexOf('\n', end);
    const prevNewline = text.lastIndexOf('\n', end);

    if (nextNewline !== -1 && nextNewline < text.length) {
      const extendedEnd = nextNewline + 1;
      const chunkText = text.slice(start, extendedEnd);
      const tokens = this.countTokens(chunkText);
      if (tokens <= limit && tokens >= minChunkTokens) {
        return extendedEnd;
      }
    }

    if (prevNewline > start) {
      const reducedEnd = prevNewline + 1;
      const chunkText = text.slice(start, reducedEnd);
      const tokens = this.countTokens(chunkText);
      if (tokens <= limit && tokens >= minChunkTokens) {
        return reducedEnd;
      }
    }

    return end;
  }

  private findNewChunkEnd(text: string, start: number, end: number): number {
    let newEnd = end - Math.floor((end - start) / 10);
    if (newEnd <= start) {
      newEnd = start + 1;
    }
    return newEnd;
  }

  private extractHeaders(text: string): Headers {
    const headers: Headers = {};
    const headerRegex = /(^|\n)(#{1,6})\s+(.*)/g;
    let match;

    while ((match = headerRegex.exec(text)) !== null) {
      const level = match[2].length;
      const content = match[3].trim();
      const key = `h${level}`;
      headers[key] = headers[key] || [];
      headers[key].push(content);
    }

    return headers;
  }

  private updateCurrentHeaders(current: Headers, extracted: Headers): void {
    for (let level = 1; level <= 6; level++) {
      const key = `h${level}`;
      if (extracted[key]) {
        current[key] = extracted[key];
        this.clearLowerHeaders(current, level);
      }
    }
  }

  private clearLowerHeaders(headers: Headers, level: number): void {
    for (let l = level + 1; l <= 6; l++) {
      delete headers[`h${l}`];
    }
  }

  private extractUrlsAndImages(text: string): { content: string; urls: string[]; images: string[] } {
    const urls: string[] = [];
    const images: string[] = [];
    let urlIndex = 0;
    let imageIndex = 0;

    const content = text
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, altText, url) => {
        images.push(url);
        return `![${altText}]({{$img${imageIndex++}}})`;
      })
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, linkText, url) => {
        urls.push(url);
        return `[${linkText}]({{$url${urlIndex++}}})`;
      });

    return { content, urls, images };
  }
}