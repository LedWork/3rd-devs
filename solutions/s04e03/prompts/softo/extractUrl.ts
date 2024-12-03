import promptfoo, { type AssertionType } from "promptfoo";
import { displayResultsAsTable } from "../../utils/utils";

export const prompt = ({ question }: { question: string }) => {
  return `You are an AI assistant helping to find relevant links that might answer a specific question.
  Review the following links and select up to 2 that are most likely to contain information about the question.
  ALWAYS return _thinking tags in your response.
  Format your response as a JSON object with a _thinking field and a links field.
  The _thinking field should contain your reasoning for selecting the links.
  The links field should be an array of strings, each representing a full URL.
  If none of the links are relevant, return ONE the most probable link that is still relevant to the question.
  Question: ${question}

  <example>
  User: {
      "https://example.com/some-dummy-site",
      "https://example.com/paris",
      "https://example.com/eiffel-tower",
      "https://example.com/germany",
      "https://example.com/contact"
  }
  Assistant: {
    "_thinking": "The links are all about Paris and the Eiffel Tower, which are relevant to the question.",
    "links": [
      "https://example.com/paris",
      "https://example.com/eiffel-tower"
    ]
  }
  </example>
  `;
};

const dataset = [
  {
    question: "What are the top attractions in New York City?",
    links: [
      "https://example.com/statue-of-liberty",
      "https://example.com/central-park",
      "https://example.com/times-square",
      "https://example.com/nyc-restaurants",
      "https://example.com/contact"
    ],
    assert: [
        {
          type: "is-json" as AssertionType,
        },
        {
          type: "llm-rubric" as AssertionType,
          value: "The output should be a valid JSON object containing '_thinking' and 'links' fields. The 'links' field should be an array of strings, each representing a full URL. The extracted links should be relevant to the question, potentially including topics like attractions in New York City."
        },
      ],
  },
  {
    question: "What are the best programming languages to learn in 2023?",
    links: [
      "https://example.com/programming-languages",
      "https://example.com/javascript",
      "https://example.com/ranking",
      "https://example.com/index.html",
      "https://example.com/contact"
    ],
    assert: [
        {
          type: "is-json" as AssertionType,
        },
        {
          type: "llm-rubric" as AssertionType,
          value: "The output should be a valid JSON object containing '_thinking' and 'links' fields. The 'links' field should be an array of strings, each representing a full URL. The extracted links should be relevant to the question, potentially including topics like best programming languages to learn in 2023."
        },
      ],
  },
  // Add more test cases as needed
];

export const chat = ({ vars }: any) => [
  {
    role: "system",
    content: prompt({ question: vars.question }),
  },
  {
    role: "user",
    content: vars.links
  },
];

export const runTest = async () => {
    const results = await promptfoo.evaluate(
    {
      prompts: [chat],
      providers: ["openai:gpt-4o-mini"],
      tests: dataset.map(
        ({ question, links, assert }) => ({
          vars: { 
            question,
            links: links.join('\n')
          },
          assert,
        })
      ),
      outputPath: "./extractUrl_results.json",
    },
    {
      maxConcurrency: 4,
    }
  );

  console.log("Evaluation Results:");
  displayResultsAsTable(results.results);
};

// Run the test if this file is executed directly
if (require.main === module) {
  runTest().catch(console.error);
}