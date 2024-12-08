import promptfoo, { type AssertionType } from "promptfoo";
import { displayResultsAsTable } from "../../utils/utils";

export const prompt = (context: string) => `<role>
You are an expert Polish document analyst specializing in precise information extraction and answer formulation.
</role>

<objective>
Your exclusive purpose is to extract and provide exact, direct answers from the provided context based on specific questions, with zero additional commentary.
</objective>

<context>
${context}
</context>

<rules>
- ABSOLUTELY REQUIRED: Extract answers ONLY from the provided context above
- MANDATORY: Format dates as YYYY-MM-DD
- MANDATORY: If date is not directly stated, infere the result from the context (the date might be incomplete, respond only with the year that best matches the context)
- MANDATORY: If a name of the place or person is not directly stated, infere the result from the context and provide description of the place or person instead of the name
- FORBIDDEN: Adding explanations or context
- FORBIDDEN: Making assumptions or inferences
- OVERRIDE: If exact answer cannot be found in context, analyze the context from the beginning and respond with the answer that best matches the context
- HANDLE NUMBERS: Preserve numerical values exactly as they appear in text
- Your response must be JSON and contain only the direct answer in the answer field and the thinking field to explain your reasoning, no additional text or formatting
</rules>

<output_format>
Return in JSON format ONLY with the exact answer found in the context in the answer field and the thinking field to explain your reasoning, no additional text or formatting
</output_format>

<examples>
CONTEXT: "Projekt został rozpoczęty 15 marca 2023 roku przez zespół deweloperów."
QUESTION: "Kiedy rozpoczęto projekt?"
ANSWER: 
{
  "thinking": "The project was started on 15th March 2023 by a team of developers.",
  "answer": "2023-03-15"
}

CONTEXT: "System kosztował 150000 złotych i został wdrożony przez firmę ABC."
QUESTION: "Jaki był koszt systemu?"
ANSWER: 
{
  "thinking": "The system cost a total of 150000 złotych and was deployed by company ABC.",
  "answer": "150000"
}

// one more example where the assistant must infere the answer from the context
CONTEXT: "Aplikacja obsługuje języki: polski, angielski oraz niemiecki."
QUESTION: "Czy aplikacja jest dostępna dla wszystkich języków?"
ANSWER: 
{
  "thinking": "The application supports 3 languages: Polish, English, and German. However, there are more languages available in the world, so it is not available for all languages.",
  "answer": "no"
}
</examples>
Here is the question:
`;

const dataset = [
    {
      context: "Projekt został rozpoczęty 15 marca 2023 roku przez zespół deweloperów z firmy XYZ.",
      question: "Kiedy rozpoczęto projekt?",
      assert: [
        {
          type: "llm-rubric" as AssertionType,
          value: "The output should be JSON with answer and thinking fields and contain exactly 2023-03-15 in the answer field."
        },
      ],
    },
    {
      context: "System kosztował 150000 złotych i został wdrożony przez firmę ABC w styczniu 2024.",
      question: "Jaki był koszt systemu?",
      assert: [
        {
          type: "llm-rubric" as AssertionType,
          value: "The output should be JSON with answer and thinking fields and contain exactly 150000 in the answer field."
        },
      ],
    },
    {
      context: "W 2024 roku Rafał wykonał skok w czasie o 10 lat do przeszłości.",
      question: "Do jakiego roku skoczył Rafał?",
      assert: [
        {
          type: "llm-rubric" as AssertionType,
          value: "The output should be JSON with answer and thinking fields and contain exactly 2014 in the answer field."
        },
      ],
    }
  ];
  
  export const chat = ({ vars }: any) => [
    {
      role: "system",
      content: prompt(vars.context),
    },
    {
      role: "user",
      content: `${vars.question}`,
    }
  ];
  
  export const runTest = async () => {
    const results = await promptfoo.evaluate(
      {
        prompts: [chat],
        providers: ["openai:gpt-4o-mini"],
        tests: dataset.map(
          ({ context, question, assert }) => ({
            vars: { context, question },
            assert,
          })
        ),
        outputPath: "./answerPrompt_results.json",
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