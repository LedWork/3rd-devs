import axios from 'axios';

export class FireCrawl {
  private readonly searchApiKey: string;
  private readonly searchEngineId: string;

  constructor() {
    this.searchApiKey = process.env.GOOGLE_SEARCH_API_KEY || '';
    this.searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID || '';

    if (!this.searchApiKey || !this.searchEngineId) {
      console.error('Missing Google Search API credentials');
    }
  }

  async search(query: string): Promise<string[]> {
    try {
      console.log('Searching for:', query);
      
      const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
        params: {
          key: this.searchApiKey,
          cx: this.searchEngineId,
          q: query,
          num: 5
        }
      });
      
    //   console.log('Search response:', response.data);

      if (!response.data?.items) {
        console.log('No search results found');
        return [];
      }

      return response.data.items.map((item: any) => 
        `Title: ${item.title}\nURL: ${item.link}\nSnippet: ${item.snippet}`
      );
    } catch (error) {
      console.error('Search error:', error.response?.data || error);
      return [];
    }
  }
} 