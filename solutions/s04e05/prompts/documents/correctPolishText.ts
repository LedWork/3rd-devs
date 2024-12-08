import promptfoo, { type AssertionType } from "promptfoo";
import { displayResultsAsTable } from "../../utils/utils";

export const prompt = () => {
  return `<role>
You are an expert Polish language proofreader and editor with extensive experience in technical writing and documentation.
</role>

<objective>
Your exclusive purpose is to correct Polish text while maintaining its original meaning, technical accuracy, and tone.
</objective>

<rules>
- ABSOLUTELY REQUIRED: Preserve all technical terms and proper names exactly as written
- MANDATORY: Correct all diacritical marks (ą, ć, ę, ł, ń, ó, ś, ź, ż)
- REQUIRED: Fix spelling, grammar, and punctuation errors
- FORBIDDEN: Changing word order unless grammatically necessary
- FORBIDDEN: Adding or removing any information
- FORBIDDEN: Providing explanations or comments
- OVERRIDE: If uncertain about a technical term, preserve it exactly as written
- HANDLE CAPITALIZATION: Proper nouns and sentence beginnings must be capitalized
- Your response must be in <answer> tags
</rules>

<output_format>
Return ONLY the corrected text, with no additional commentary or explanations.
</output_format>

<examples>
INPUT: "python jest jezykiem programowania wysokiego poziomu"
OUTPUT: <answer>Python jest językiem programowania wysokiego poziomu.</answer>

INPUT: "framework REACT.js sluzy do tworzenia aplikacji webowych"
OUTPUT: <answer>Framework React.js służy do tworzenia aplikacji webowych.</answer>

INPUT: "baza danych Postgresql jest czesto uzywana w projektach"
OUTPUT: <answer>Baza danych PostgreSQL jest często używana w projektach.</answer>
</examples>

Text to correct:`;
};

const dataset = [
  {
    text: "Aplikacja zostala napisana w jezyku Python wykorzystujac framework Django.",
    assert: [
      {
        type: "llm-rubric" as AssertionType,
        value: "The output should have the <answer> tags. The output should be properly formatted Polish text with correct diacritical marks, spelling, and punctuation while maintaining the original meaning."
      },
    ],
  },
  {
    text: "system operacyiny linux jest bardzo popularny wsród programistów",
    assert: [
      {
        type: "llm-rubric" as AssertionType,
        value: "The output should have the <answer> tags.The output should be properly formatted Polish text with correct capitalization, diacritical marks, and punctuation while maintaining the original meaning."
      },
    ],
  },
];

export const chat = ({ vars }: any) => [
  {
    role: "system",
    content: prompt(),
  },
  {
    role: "user",
    content: vars.text,
  }
];

export const runTest = async () => {
  const results = await promptfoo.evaluate(
    {
      prompts: [chat],
      providers: ["openai:gpt-4o-mini"],
      tests: dataset.map(
        ({ text, assert }) => ({
          vars: { text },
          assert,
        })
      ),
      outputPath: "./correctPolishText_results.json",
    },
    {
      maxConcurrency: 4,
    }
  );

  console.log("Evaluation Results:");
  displayResultsAsTable(results.results);
};

if (require.main === module) {
  runTest().catch(console.error);
} 