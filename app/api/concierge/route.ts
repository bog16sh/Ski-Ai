import { NextResponse } from "next/server";
import { createBooking, type BookingInput } from "@/lib/bookings";
import { type StudioVoicePromptKey } from "@/lib/studioVoicePack";

export const runtime = "nodejs";

type BookingState = {
  fullName?: string;
  phone?: string;
  bookingDate?: string;
  bookingTime?: string;
  skillLevel?: string;
  bootSize?: string;
};

type BookingField = keyof BookingState;
type ExtractedFields = Partial<BookingState>;

type IncomingBody = {
  message: string;
  state?: BookingState;
};

type OllamaConciergeResult = {
  extracted: ExtractedFields;
  reply: string;
  model: string;
};

type OllamaChatResponse = {
  model?: string;
  message?: {
    content?: string;
  };
  error?: string;
};

const REQUIRED_FIELDS = [
  "fullName",
  "phone",
  "bookingDate",
  "bookingTime",
  "skillLevel",
  "bootSize",
] as const satisfies readonly BookingField[];

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "llama3.2:latest";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as IncomingBody;
    const message = body.message?.trim();

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const state = body.state ?? {};
    const missingFields = REQUIRED_FIELDS.filter((field) => !state[field]);

    if (missingFields.length === 0) {
      const reply = buildCompletionMessage(state);
      return NextResponse.json({
        reply,
        extracted: {},
        state,
        done: true,
        audioKey: "bookingComplete" satisfies StudioVoicePromptKey,
      });
    }

    const nextExpectedField = missingFields[0];
    const ollamaResult = await askOllamaConcierge(message, state, missingFields);
    const fallbackExtracted = extractFallbackFields(
      message,
      state,
      missingFields,
      nextExpectedField
    );
    const extracted = { ...fallbackExtracted, ...ollamaResult.extracted };
    const mergedState = { ...state, ...extracted };
    const newMissingFields = REQUIRED_FIELDS.filter((field) => !mergedState[field]);
    const nextFieldAfterExtraction = newMissingFields[0] || null;
    const done = newMissingFields.length === 0;
    const savedBooking = done ? await createBooking(toBookingInput(mergedState)) : null;
    const prompt = done
      ? {
          reply: buildCompletionMessage(mergedState),
          audioKey: "bookingComplete" as const,
        }
      : generateReply(nextFieldAfterExtraction);

    return NextResponse.json({
      reply: prompt.reply,
      extracted,
      state: mergedState,
      done,
      booking: savedBooking,
      audioKey: prompt.audioKey,
      llm: {
        provider: "ollama",
        model: ollamaResult.model,
      },
      progress: {
        collected: REQUIRED_FIELDS.length - newMissingFields.length,
        remaining: newMissingFields.length,
        total: REQUIRED_FIELDS.length,
      },
    });
  } catch (error: unknown) {
    console.error("Concierge error:", error);
    const message = error instanceof Error ? error.message : "Failed to process message";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function askOllamaConcierge(
  message: string,
  state: BookingState,
  missingFields: readonly BookingField[]
): Promise<OllamaConciergeResult> {
  const model = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  const baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
  const response = await fetch(new URL("/api/chat", baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      options: {
        temperature: 0.1,
      },
      messages: [
        {
          role: "system",
          content: [
            "You are AI Frontdesk, a ski rental voice booking concierge.",
            "Extract booking details from the guest's latest message and produce a short spoken reply.",
            "Return JSON only, with this exact shape:",
            '{"extracted":{"fullName":"string","phone":"string","bookingDate":"string","bookingTime":"string","skillLevel":"beginner|intermediate|pro","bootSize":"string"},"reply":"string"}',
            "Rules:",
            "- Only include fields in extracted when the latest guest message explicitly provides them.",
            "- Never invent missing values.",
            "- Normalize phone numbers to digits when possible.",
            "- Normalize skillLevel to one of: beginner, intermediate, pro.",
            "- Keep bookingDate and bookingTime as the guest naturally said them.",
            "- The reply should be friendly, concise, and ask for the next missing field after considering extracted values.",
            "- If the guest gives multiple booking details in one message, extract all of them.",
            "- If the guest sounds uncertain about a value, like maybe, not sure, or I don't know, do not extract that value.",
            "- Do not ask for payment, address, email, or anything outside the booking fields.",
            "Example: If the guest says 'my phone is 555-123-4567 and my boot size is 10', return extracted phone '5551234567' and bootSize '10'.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            currentState: state,
            requiredFieldOrder: REQUIRED_FIELDS,
            missingFields,
            latestGuestMessage: message,
          }),
        },
      ],
    }),
  });

  const data = (await response.json()) as OllamaChatResponse;

  if (!response.ok || data.error) {
    throw new Error(
      data.error ||
        `Ollama request failed. Is Ollama running at ${baseUrl} with model ${model}?`
    );
  }

  const content = data.message?.content;

  if (!content) {
    throw new Error(`Ollama returned an empty response for model ${model}.`);
  }

  const parsed = parseJsonObject(content);
  const extracted = sanitizeExtracted(parsed.extracted, state, message);
  const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";

  return {
    extracted,
    reply,
    model: data.model || model,
  };
}

function toBookingInput(state: BookingState): BookingInput {
  return {
    fullName: state.fullName!,
    phone: state.phone!,
    bookingDate: state.bookingDate!,
    bookingTime: state.bookingTime!,
    skillLevel: state.skillLevel!,
    bootSize: state.bootSize!,
  };
}

function parseJsonObject(content: string): Record<string, unknown> {
  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error("Ollama did not return valid JSON.");
    }

    return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  }
}

function sanitizeExtracted(
  value: unknown,
  currentState: BookingState,
  latestMessage: string
): ExtractedFields {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const input = value as Record<string, unknown>;
  const extracted: ExtractedFields = {};

  for (const field of REQUIRED_FIELDS) {
    if (currentState[field]) {
      continue;
    }

    const rawValue = input[field];

    if (rawValue === undefined || rawValue === null) {
      continue;
    }

    const rawText = String(rawValue);
    const normalized = normalizeFieldValue(field, rawText);

    if (normalized && isExplicitlySupportedByMessage(field, normalized, rawText, latestMessage)) {
      extracted[field] = normalized;
    }
  }

  return extracted;
}

function normalizeFieldValue(field: BookingField, value: string): string {
  const trimmed = value.trim();

  if (!trimmed || trimmed.toLowerCase() === "unknown") {
    return "";
  }

  if (field === "phone") {
    const digits = trimmed.replace(/[^0-9]/g, "");
    return digits.length >= 10 ? digits : "";
  }

  if (field === "skillLevel") {
    const lower = trimmed.toLowerCase();

    if (lower.includes("beginner") || lower.includes("newbie")) {
      return "beginner";
    }

    if (lower.includes("intermediate")) {
      return "intermediate";
    }

    if (lower.includes("advanced") || lower.includes("pro") || lower.includes("expert")) {
      return "pro";
    }

    return "";
  }

  if (field === "bootSize") {
    const bootMatch = trimmed.match(/\b(\d{1,2}(?:\.\d+)?)\b/);

    if (!bootMatch) {
      return "";
    }

    const bootSize = Number(bootMatch[1]);
    return bootSize >= 5 && bootSize <= 20 ? bootMatch[1] : "";
  }

  return trimmed;
}

function isExplicitlySupportedByMessage(
  field: BookingField,
  normalizedValue: string,
  rawValue: string,
  message: string
): boolean {
  const lowerMessage = message.toLowerCase();
  const lowerValue = normalizedValue.toLowerCase();
  const lowerRawValue = rawValue.toLowerCase().trim();

  if (field === "fullName") {
    return isSupportedName(normalizedValue, message);
  }

  if (field === "phone") {
    const messageDigits = message.replace(/[^0-9]/g, "");
    const valueDigits = normalizedValue.replace(/[^0-9]/g, "");
    return valueDigits.length >= 10 && messageDigits.includes(valueDigits);
  }

  if (field === "bootSize") {
    const escapedValue = escapeRegExp(normalizedValue);
    return new RegExp(
      `\\b(?:boot(?:\\s+size)?|size)(?:\\s+is)?\\s*${escapedValue}\\b`,
      "i"
    ).test(message);
  }

  if (field === "skillLevel") {
    if (normalizedValue === "beginner") {
      return /\b(?:beginner|newbie)\b/i.test(message);
    }

    if (normalizedValue === "intermediate") {
      return /\bintermediate\b/i.test(message);
    }

    return /\b(?:advanced|expert|pro)\b/i.test(message);
  }

  if (field === "bookingDate") {
    const dateMatch = message.match(
      /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:\s+\d{4})?\b/i
    );
    const numericDateMatch = message.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/);
    const relativeDate = ["today", "tomorrow", "next weekend"].find((phrase) =>
      lowerMessage.includes(phrase)
    );

    return Boolean(
      (dateMatch &&
        (dateMatch[0].toLowerCase().includes(lowerValue) ||
          lowerValue.includes(dateMatch[0].toLowerCase()) ||
          dateMatch[0].toLowerCase().includes(lowerRawValue))) ||
        (numericDateMatch &&
          (numericDateMatch[0].toLowerCase() === lowerValue ||
            numericDateMatch[0].toLowerCase() === lowerRawValue)) ||
        (relativeDate && lowerValue === relativeDate)
    );
  }

  if (field === "bookingTime") {
    const timeMatch = message.match(/\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i);
    const clockMatch = message.match(/\b\d{1,2}:\d{2}\b/);
    const timePhrase = ["morning", "afternoon", "evening", "night"].find((phrase) =>
      lowerMessage.includes(phrase)
    );

    return Boolean(
      (timeMatch &&
        (timeMatch[0].replace(/^at\s+/i, "").toLowerCase() === lowerValue ||
          timeMatch[0].replace(/^at\s+/i, "").toLowerCase() === lowerRawValue)) ||
        (clockMatch &&
          (clockMatch[0].toLowerCase() === lowerValue ||
            clockMatch[0].toLowerCase() === lowerRawValue)) ||
        (timePhrase && lowerValue === timePhrase)
    );
  }

  return false;
}

function isSupportedName(name: string, message: string): boolean {
  if (!isPlausibleName(name)) {
    return false;
  }

  const normalizedName = normalizeName(name);
  const normalizedMessage = normalizeName(message);

  if (normalizedMessage === normalizedName) {
    return true;
  }

  const introMatch = message.match(
    /\b(?:my name is|i'm|i am|it's)\s+([A-Za-z][A-Za-z\s'-]{0,80})/i
  );

  if (!introMatch) {
    return false;
  }

  const introducedName = normalizeName(introMatch[1]);
  return introducedName === normalizedName || introducedName.startsWith(`${normalizedName} `);
}

function isPlausibleName(name: string): boolean {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const blockedWords = new Set([
    "i",
    "im",
    "i'm",
    "am",
    "hi",
    "hello",
    "hey",
    "ok",
    "okay",
    "yes",
    "yeah",
    "yep",
    "thanks",
    "thank",
    "you",
    "not",
    "no",
    "none",
    "unknown",
    "sure",
    "maybe",
    "later",
    "today",
    "tomorrow",
    "morning",
    "afternoon",
    "evening",
    "night",
  ]);

  return (
    words.length >= 1 &&
    words.length <= 4 &&
    words.every((word) => /^[A-Za-z][A-Za-z'-]*$/.test(word)) &&
    words.every((word) => !blockedWords.has(word.toLowerCase()))
  );
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractFallbackFields(
  message: string,
  currentState: BookingState,
  missingFields: readonly BookingField[],
  expectedField: BookingField
): ExtractedFields {
  const extracted: ExtractedFields = {};
  const lower = message.toLowerCase();

  for (const field of missingFields) {
    if (currentState[field]) {
      continue;
    }

    if (field === "phone") {
      const digitsOnly = message.replace(/[^0-9]/g, "");

      if (digitsOnly.length >= 10) {
        extracted.phone = digitsOnly;
      }
    }

    if (field === "bootSize") {
      const bootMatch =
        message.match(/\bboot(?:\s+size)?(?:\s+is)?\s*(\d{1,2}(?:\.\d+)?)\b/i) ||
        message.match(/\bsize(?:\s+is)?\s*(\d{1,2}(?:\.\d+)?)\b/i) ||
        (field === expectedField && !isUncertainAnswer(message)
          ? message.match(/\b(\d{1,2}(?:\.\d+)?)\b/)
          : null);

      if (bootMatch) {
        const bootSize = Number(bootMatch[1]);

        if (bootSize >= 5 && bootSize <= 20) {
          extracted.bootSize = bootMatch[1];
        }
      }
    }

    if (field === "skillLevel") {
      if (/\b(?:beginner|newbie)\b/i.test(message)) {
        extracted.skillLevel = "beginner";
      } else if (/\bintermediate\b/i.test(message)) {
        extracted.skillLevel = "intermediate";
      } else if (/\b(?:advanced|expert|pro)\b/i.test(message)) {
        extracted.skillLevel = "pro";
      }
    }

    if (field === "bookingDate") {
      const dateMatch = message.match(
        /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:\s+\d{4})?\b/i
      );
      const numericDateMatch = message.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);

      if (dateMatch) {
        extracted.bookingDate = dateMatch[0];
      } else if (numericDateMatch) {
        extracted.bookingDate = numericDateMatch[0];
      } else if (lower.includes("next weekend")) {
        extracted.bookingDate = "next weekend";
      } else if (lower.includes("tomorrow")) {
        extracted.bookingDate = "tomorrow";
      } else if (lower.includes("today")) {
        extracted.bookingDate = "today";
      }
    }

    if (field === "bookingTime") {
      const timeMatch = message.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
      const clockMatch = message.match(/\b\d{1,2}:\d{2}\b/);

      if (timeMatch) {
        extracted.bookingTime = timeMatch[0].replace(/^at\s+/i, "");
      } else if (clockMatch) {
        extracted.bookingTime = clockMatch[0];
      } else if (lower.includes("morning")) {
        extracted.bookingTime = "morning";
      } else if (lower.includes("afternoon")) {
        extracted.bookingTime = "afternoon";
      } else if (lower.includes("evening") || lower.includes("night")) {
        extracted.bookingTime = "evening";
      }
    }
  }

  if (!currentState.fullName && missingFields.includes("fullName")) {
    const nameExtracted = extractFromMessage(message, currentState, "fullName");

    if (nameExtracted.fullName && isSupportedName(nameExtracted.fullName, message)) {
      extracted.fullName = nameExtracted.fullName;
    }
  }

  return extracted;
}

function isUncertainAnswer(message: string): boolean {
  return /\b(?:maybe|not sure|don't know|dont know|do not know|i don't know|i dont know|unsure|no idea)\b/i.test(
    message
  );
}

function extractFromMessage(
  message: string,
  currentState: BookingState,
  expectedField: BookingField
): ExtractedFields {
  const extracted: ExtractedFields = {};
  const lower = message.toLowerCase();

  if (!currentState.fullName && (expectedField === "fullName" || !anyFieldExtracted(currentState))) {
    const patternMatch = message.match(/(?:my name is|i'm|i am|it's)\s+([A-Za-z\s'-]+?)(?:\s|$|\.)/i);
    if (patternMatch) {
      const potentialName = patternMatch[1].trim();
      const words = potentialName.split(/\s+/);
      if (
        words.length <= 3 &&
        words.every((w) => /^[A-Za-z'-]+$/.test(w)) &&
        isSupportedName(potentialName, message)
      ) {
        extracted.fullName = potentialName;
        return extracted;
      }
    }
    const simpleMatch = message.match(/^([A-Za-z\s'-]{2,})$/);
    if (simpleMatch) {
      const potentialName = simpleMatch[1].trim();
      const words = potentialName.split(/\s+/);
      if (
        words.length <= 3 &&
        words.every((w) => /^[A-Za-z'-]+$/.test(w)) &&
        isSupportedName(potentialName, message)
      ) {
        extracted.fullName = potentialName;
        return extracted;
      }
    }
  }

  if (!currentState.phone && expectedField === "phone") {
    const digitsOnly = message.replace(/[^0-9]/g, "");
    if (digitsOnly.length >= 10) {
      extracted.phone = digitsOnly;
      return extracted;
    }
  }

  if (!currentState.bootSize && expectedField === "bootSize") {
    const bootMatch = message.match(/\b(\d{1,2}(?:\.\d+)?)\b/);
    if (bootMatch) {
      const num = parseFloat(bootMatch[1]);
      if (num >= 5 && num <= 20) {
        extracted.bootSize = bootMatch[1];
        return extracted;
      }
    }
  }

  if (!currentState.skillLevel && expectedField === "skillLevel") {
    if (/\b(?:beginner|newbie)\b/i.test(message)) {
      extracted.skillLevel = "beginner";
      return extracted;
    } else if (/\bintermediate\b/i.test(message)) {
      extracted.skillLevel = "intermediate";
      return extracted;
    } else if (/\b(?:advanced|expert|pro)\b/i.test(message)) {
      extracted.skillLevel = "pro";
      return extracted;
    }
  }

  if (!currentState.bookingDate && expectedField === "bookingDate") {
    const dateMatch1 = message.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:\s+\d{4})?\b/i);
    if (dateMatch1) {
      extracted.bookingDate = dateMatch1[0];
      return extracted;
    }
    const dateMatch2 = message.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
    if (dateMatch2) {
      extracted.bookingDate = dateMatch2[0];
      return extracted;
    }
    if (lower.includes("next weekend")) {
      extracted.bookingDate = "next weekend";
      return extracted;
    }
    if (lower.includes("tomorrow")) {
      extracted.bookingDate = "tomorrow";
      return extracted;
    }
    if (lower.includes("today")) {
      extracted.bookingDate = "today";
      return extracted;
    }
  }

  if (!currentState.bookingTime && expectedField === "bookingTime") {
    const timeMatch = message.match(/\b(\d{1,2}):?(\d{2})?\s*(am|pm)?\b/i);
    if (timeMatch) {
      extracted.bookingTime = timeMatch[0];
      return extracted;
    }
    if (lower.includes("morning")) {
      extracted.bookingTime = "morning";
      return extracted;
    }
    if (lower.includes("afternoon")) {
      extracted.bookingTime = "afternoon";
      return extracted;
    }
    if (lower.includes("evening") || lower.includes("night")) {
      extracted.bookingTime = "evening";
      return extracted;
    }
  }

  return extracted;
}

function anyFieldExtracted(state: BookingState): boolean {
  return REQUIRED_FIELDS.some((field) => Boolean(state[field]));
}

function generateReply(nextField: BookingField | null): {
  audioKey: StudioVoicePromptKey;
  reply: string;
} {
  switch (nextField) {
    case "fullName":
      return {
        audioKey: "askFullName",
        reply:
          "I'll need your full name, phone number, rental date, pickup time, ski level, and boot size. We can do it one at a time. What is your full name?",
      };
    case "phone":
      return {
        audioKey: "askPhone",
        reply: "I still need your phone number for the booking. What number should I use?",
      };
    case "bookingDate":
      return {
        audioKey: "askBookingDate",
        reply: "I still need the rental date. What day would you like to pick up the gear?",
      };
    case "bookingTime":
      return {
        audioKey: "askBookingTime",
        reply: "I still need a pickup time. Morning, afternoon, or an exact time is fine.",
      };
    case "skillLevel":
      return {
        audioKey: "askSkillLevel",
        reply:
          "I still need your ski level. Would you call yourself beginner, intermediate, or advanced?",
      };
    case "bootSize":
      return {
        audioKey: "askBootSize",
        reply: "I still need your boot size. You can just say a number like 10, 11, or 12.",
      };
    default:
      return {
        audioKey: "bookingComplete",
        reply: "All set.",
      };
  }
}

function buildCompletionMessage(state: BookingState): string {
  const name = state.fullName ? state.fullName.split(" ")[0] : "Friend";
  const date = state.bookingDate || "your date";
  const time = state.bookingTime || "your time";
  const level = state.skillLevel ? state.skillLevel.toUpperCase() : "your level";
  const boots = state.bootSize || "your size";
  const phone = state.phone || "your number";

  return `Perfect, ${name}! 🎿 Your booking is all set!\n\n📅 Date: ${date}\n⏰ Time: ${time}\n🏂 Skill Level: ${level}\n👢 Boot Size: ${boots}\n\nWe'll call ${phone} to confirm. Get ready for an amazing day on the slopes! 🏔️`;
}
