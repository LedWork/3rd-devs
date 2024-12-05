import promptfoo, { type AssertionType } from "promptfoo";
import { displayResultsAsTable } from "../../utils/utils";

export const prompt = () => {
  return `You are an AI assistant helping navigate a drone on a 4x4 map. The drone starts at position S (START).
  The map looks like this:

  S T D H
  T W T T
  T T K L
  K K A J

  Legend:
  S = START
  T = TRAWA (grass)
  D = DRZEWO, TRAWA (tree, grass)
  H = DOM (house)
  W = WIATRAK, TRAWA (windmill, grass)
  K = SKAŁY (rocks)
  L = TRAWA, DRZEWA (grass, trees)
  A = SAMOCHÓD (car)
  J = JASKINIA (cave)

  The drone can move in 4 directions: UP, DOWN, LEFT, RIGHT by 1-4 spaces.
  Always start from position S.
  Process the natural language instruction into a series of moves and determine the final position.
  Return a JSON object with:
  - _thinking: your step-by-step reasoning
  - moves: array of moves you determined from the instruction
  - finalPosition: coordinates [row, col] of final position (0-3)
  - description: what is at the final position (in Polish, max 2 words)

  Example:
  Input: "Leć dwa pola w prawo i jedno w dół"
  Output: {
    "_thinking": "1. Start at S [0,0]\n2. Move right 2 spaces to D [0,2]\n3. Move down 1 space to T [1,2]",
    "moves": ["RIGHT 2", "DOWN 1"],
    "finalPosition": [1, 2],
    "description": "trawa"
  }`;
};

const dataset = [
  {
    instruction: "Leć dwa pola w prawo",
    assert: [
      {
        type: "is-json" as AssertionType,
      },
      {
        type: "llm-rubric" as AssertionType,
        value: "The output should be a valid JSON with _thinking, moves, finalPosition and description fields. For this instruction, the drone should end up at position D (drzewo, trawa)."
      },
    ],
  },
  {
    instruction: "Leć dwa pola w dół i dwa w prawo",
    assert: [
      {
        type: "is-json" as AssertionType,
      },
      {
        type: "llm-rubric" as AssertionType,
        value: "The output should be a valid JSON with _thinking, moves, finalPosition and description fields. In the finalPosition, it should be [2, 2]. The description should be 'skały'."
      },
    ],
  },
  {
    instruction: "Jedno w prawo, w prawo do końca, w dół do końca, raz w lewo, raz w górę, raz w prawo, raz w dół",
    assert: [
      {
        type: "is-json" as AssertionType,
      },
      {
        type: "llm-rubric" as AssertionType,
        value: "The output should be a valid JSON. It should contain _thinking, moves, finalPosition and description fields. In the finalPosition, it should be [3, 3]. In the description, it should be 'jaskinia'."
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
    content: vars.instruction,
  },
];

export const runTest = async () => {
  const results = await promptfoo.evaluate(
    {
      prompts: [chat],
      providers: ["openai:gpt-4o-mini"],
      tests: dataset.map(({ instruction, assert }) => ({
        vars: { instruction },
        assert,
      })),
      outputPath: "./navigate_results.json",
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