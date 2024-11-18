import type { ChatCompletion } from "openai/resources/chat/completions";
import { OpenAIService } from "../audio/OpenAIService";
import { ElevenLabsService } from "./ElevenLabsService";
import { mkdir, rm } from "fs/promises";
import { join } from "path";
import { narrationPrompt } from "./prompts";
import {  mergeAudio, type AudioSegment } from "./utils/audio";

const openai = new OpenAIService();
const elevenlabsService = new ElevenLabsService();

async function generateAudioChunks(segments: string[], context: string) {
  const fragmentsDir = join(__dirname, "fragments");
  await mkdir(fragmentsDir, { recursive: true });

  const generateSegment = async (segment: string, index: number) => {
    if (isEffectSegment(segment)) {
      return processEffects(segment, index, fragmentsDir, context);
    }
    return processSpeech(segment, index, fragmentsDir);
  };

  const audioSegmentsNested = await Promise.all(
    segments.map((segment, index) => generateSegment(segment, index))
  );

  return audioSegmentsNested.flat();
}

function isEffectSegment(segment: string): boolean {
  return segment.startsWith("[") && segment.endsWith("]");
}

async function processEffects(
  segment: string,
  index: number,
  dir: string,
  context: string
) {
  const effects = segment
    .slice(1, -1)
    .split(";")
    .map((effect) => effect.trim());
  console.log("Generating sound effects:", effects);

  const effectPromises = effects.map(async (effect, i) => {
    const filePath = join(dir, `effect_${index}_${i}.wav`);
    await elevenlabsService.generateSoundEffect({
      text: effect,
      outputPath: filePath,
      durationSeconds: 2.5,
      promptInfluence: 1.0,
      context,
    });
    return { type: "effect", file: filePath, index };
  });

  return Promise.all(effectPromises);
}

async function processSpeech(segment: string, index: number, dir: string) {
  console.log("Generating speech:", segment);
  const filePath = join(dir, `speech_${index}.wav`);
  await elevenlabsService.generateSpeech({
    text: segment,
    outputPath: filePath,
  });
  return { type: "speech", file: filePath, index };
}

/*
  Split the narration text into segments based on square brackets
  This regex matches either content within square brackets or content outside brackets
*/
function makeSegmentsFrom(narrationText: string): string[] {
  if (!narrationText) return [];
  const segments =
    narrationText.match(/(\[.*?\]|[^\[\]]+)/g)?.map((s) => s.trim()) || [];
  return segments.filter((segment) => segment.length > 5);
}

async function generateNarration() {
  const narration = (await openai.completion({
    messages: [
      { role: "user", content: narrationPrompt },
      {
        role: "user",
        content: `Make sound for the narration of this Sherlock Holmes scene. Here's the narration you should use:
            ''Sherlock Holmes's quick eye took in my occupation, and he shook his head with a smile as he noticed my questioning glances. "Beyond the obvious facts that he has at some time done manual labor, that he takes snuff, that he is a Freemason, that he has been in China, and that he has done a considerable amount of writing lately, I can deduce nothing else."

            Mr. Jabez Wilson started up in his chair, with his forefinger upon the paper, but his eyes upon my companion.

            "How, in the name of good-fortune, did you know all that, Mr. Holmes?" he asked. "How did you know, for example, that I did manual labor. It's as true as gospel, for I began as a ship's carpenter."'
        
        Make sounds typical to the mystery and detective genre, with Victorian era atmosphere    `,
      },
    ],
  })) as ChatCompletion;

  return narration.choices?.[0].message.content;
}

async function main() {
  await rm(join(__dirname, "fragments"), { recursive: true, force: true, }).catch(() => {});

  const narration = (await generateNarration()) ?? "No narration generated";
  console.log(`Generated narration:`, narration);
  const segments = makeSegmentsFrom(narration);
  console.log(`Extracted segments:`, segments);
  const chunks = await generateAudioChunks(segments, narration);

  await mergeAudio(chunks as AudioSegment[]);
}

main().catch(console.error);
