import promptfoo, { type AssertionType } from "promptfoo";
import { displayResultsAsTable } from "../utils";

export const prompt = () => `You are a Person Identifier specialized in analyzing images of women. 
Your task is to determine if an image contains a woman and provide a description if it does.

<rules>
- Analyze the image description for presence of a woman
- If a woman is present, provide a detailed description of her appearance
- Include details about: hair, face, clothing, approximate age if possible
- If no woman is present, return NONE
- Be specific and objective in descriptions
- Output must be in Polish
- Focus on the specific details of the woman, not the background or other objects
</rules>

<output_format>
{
  "_thinking": "Explain how you determined if a woman is present and what details you noticed",
  "result": "detailed description in Polish or NONE"
}
</output_format>

<examples>
Input: "A young woman with long brown hair wearing a red dress stands near a window."
Output: {
  "_thinking": "Image clearly shows a woman, noting physical characteristics and clothing",
  "result": "Młoda kobieta z długimi brązowymi włosami, ubrana w czerwoną sukienkę. Stoi przy oknie."
}

Input: "A cityscape showing buildings and cars during sunset."
Output: {
  "_thinking": "No people visible in the image",
  "result": "NONE"
}
</examples>`;

const dataset = [
    {
        query: "A woman in her 30s with blonde hair wearing a business suit.",
        assert: [
            {
                type: "is-json" as AssertionType,
            },
            {
                type: "javascript" as AssertionType,
                value: `
                    const response = JSON.parse(output);
                    return response.result !== "NONE" && response.result.includes("kobieta");
                `
            }
        ]
    },
    {
        query: "A landscape photo of mountains and lakes.",
        assert: [
            {
                type: "is-json" as AssertionType,
                value: {
                    result: "NONE"
                }
            }
        ]
    }
];

export const runTest = async () => {
    const results = await promptfoo.evaluate({
        prompts: [prompt],
        providers: ["openai:gpt-4o-mini"],
        tests: dataset,
        outputPath: "./promptfoo_results.json",
    });

    console.log("Evaluation Results:");
    displayResultsAsTable(results.results);
};

// Run the test if this file is executed directly
if (require.main === module) {
    runTest().catch(console.error);
}
