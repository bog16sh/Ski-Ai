export const STUDIO_VOICE_PACK_ID = "bella";
export const STUDIO_VOICE_PACK_LABEL = "Free voice: Bella";
export const STUDIO_VOICE_NAME = "af_bella";
export const STUDIO_VOICE_FILE_EXTENSION = "wav";

export const STUDIO_VOICE_PROMPTS = {
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
} as const;

export type StudioVoicePromptKey = keyof typeof STUDIO_VOICE_PROMPTS;

export const STUDIO_VOICE_PROMPT_KEYS = Object.keys(
  STUDIO_VOICE_PROMPTS
) as StudioVoicePromptKey[];

const STUDIO_VOICE_PUBLIC_ROOT = `/voice-pack/${STUDIO_VOICE_PACK_ID}`;

export function getStudioVoiceFilePath(key: StudioVoicePromptKey) {
  return `${STUDIO_VOICE_PUBLIC_ROOT}/${key}.${STUDIO_VOICE_FILE_EXTENSION}`;
}
