import { WebSearchService } from './services/WebSearch';
import { SoftoService } from './services/SoftoService';
import type { WebContent } from './types/types';

// const webSearchService = new WebSearchService();
// const crawledContentArray = await webSearchService.crawlUrls(['https://softo.ag3nts.org'], '') as WebContent[];
// const flattenedContentArray = crawledContentArray.flat(); // Flatten the array of arrays

// if (flattenedContentArray.length > 0) {
//     console.log(`Crawled content: ${flattenedContentArray.length} items`);

//     // save crawledcontent links to visitedUrls
//     flattenedContentArray.forEach((item) => console.log(item.url));

// }

const softoService = new SoftoService();
const links = await softoService.findMostRelevantLinks(['https://softo.ag3nts.org/programming'], 'What are the best programming languages to learn in 2023?');
console.log(links);


// console.log(scrapedContent);