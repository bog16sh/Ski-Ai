import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KokoroTTS } from "kokoro-js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const studioVoicePackId = "bella";
const studioVoiceName = "af_bella";
const studioVoicePrompts = {
  preview:
    "Hi, this is AI Frontdesk. This is the free local voice you'll hear during the booking.",
  intro:
    "Hi, this is AI Frontdesk for Summit Ridge Rentals. I can get your ski rental started. I'll need your full name, phone number, rental date, pickup time, ski level, and boot size. You can tell me everything at once, or we can go one step at a time. What's your full name?",
  askFullName:
    "I'll need your full name, phone number, rental date, pickup time, ski level, and boot size. We can do it one at a time. What is your full name?",
  askPhone:
    "I still need your phone number for the booking. What number should I use?",
  askBookingDate:
    "I still need the rental date. What day would you like to pick up the gear?",
  askBookingTime:
    "I still need a pickup time. Morning, afternoon, or an exact time is fine.",
  askSkillLevel:
    "I still need your ski level. Would you call yourself beginner, intermediate, or advanced?",
  askBootSize:
    "I still need your boot size. You can just say a number like 10, 11, or 12.",
  bookingComplete:
    "Perfect. Your booking is all set. We'll confirm the details with you shortly.",
};
const modelId = "onnx-community/Kokoro-82M-v1.0-ONNX";
const outputDir = resolve(projectRoot, "public", "voice-pack", studioVoicePackId);
const shouldOverwrite = process.argv.includes("--force");

mkdirSync(outputDir, { recursive: true });

let lastProgressLabel = "";
console.log(`Loading Kokoro voice ${studioVoiceName}...`);
const tts = await KokoroTTS.from_pretrained(modelId, {
  dtype: "q8",
  device: "cpu",
  progress_callback: (progress) => {
    const parts = [progress.status, progress.file ?? progress.name].filter(Boolean);
    const label = parts.join(" | ");

    if (label && label !== lastProgressLabel) {
      console.log(label);
      lastProgressLabel = label;
    }
  },
});

for (const [key, text] of Object.entries(studioVoicePrompts)) {
  const filePath = resolve(outputDir, `${key}.wav`);

  if (!shouldOverwrite && existsSync(filePath)) {
    console.log(`Skipping ${key}, file already exists.`);
    continue;
  }

  console.log(`Generating ${key}...`);
  const audio = await tts.generate(text, {
    voice: studioVoiceName,
    speed: 1,
  });
  await audio.save(filePath);
}

console.log(`Free voice pack is ready in ${outputDir}`);
