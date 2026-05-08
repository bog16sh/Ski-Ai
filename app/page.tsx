"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SVGProps } from "react";
import {
  getStudioVoiceFilePath,
  STUDIO_VOICE_PACK_LABEL,
  STUDIO_VOICE_PROMPT_KEYS,
  STUDIO_VOICE_PROMPTS,
  type StudioVoicePromptKey,
} from "@/lib/studioVoicePack";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type BookingKey =
  | "fullName"
  | "phone"
  | "bookingDate"
  | "bookingTime"
  | "skillLevel"
  | "bootSize";

type BookingState = Partial<Record<BookingKey, string>>;

type ConciergeResponse = {
  audioKey?: StudioVoicePromptKey;
  done?: boolean;
  error?: string;
  extracted?: Partial<Record<BookingKey, string>>;
  reply?: string;
  state?: BookingState;
};

const initialGreeting = STUDIO_VOICE_PROMPTS.intro;

const bookingFields: { key: BookingKey; label: string; hint: string }[] = [
  { key: "fullName", label: "Guest", hint: "Name" },
  { key: "phone", label: "Phone", hint: "Contact" },
  { key: "bookingDate", label: "Date", hint: "Rental day" },
  { key: "bookingTime", label: "Time", hint: "Pickup" },
  { key: "skillLevel", label: "Level", hint: "Ability" },
  { key: "bootSize", label: "Boots", hint: "Size" },
];

const preferredVoicePatterns = [
  /natural/i,
  /enhanced/i,
  /samantha/i,
  /serena/i,
  /ava/i,
  /allison/i,
  /victoria/i,
  /karen/i,
  /moira/i,
  /susan/i,
  /siri/i,
  /aria/i,
  /jenny/i,
  /google us english/i,
];

function prepareTextForSpeech(text: string) {
  return text
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/[\u200D\uFE0E\uFE0F]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function scoreVoice(voice: SpeechSynthesisVoice) {
  let score = 0;

  if (/^en-US$/i.test(voice.lang)) {
    score += 40;
  } else if (/^en/i.test(voice.lang)) {
    score += 20;
  }

  if (voice.localService) {
    score += 15;
  }

  if (voice.default) {
    score += 10;
  }

  preferredVoicePatterns.forEach((pattern, index) => {
    if (pattern.test(voice.name)) {
      score += 200 - index;
    }
  });

  return score;
}

function pickPreferredVoice(voices: SpeechSynthesisVoice[]) {
  return (
    [...voices]
      .filter((voice) => /^en/i.test(voice.lang))
      .sort((left, right) => scoreVoice(right) - scoreVoice(left))[0] ||
    voices[0] ||
    null
  );
}

function MicIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" {...props}>
      <path
        d="M12 14.5a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 0 0-7 0v5a3.5 3.5 0 0 0 3.5 3.5Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M18.5 10.5a6.5 6.5 0 0 1-13 0M12 17v3.5M8.5 20.5h7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function SendIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" {...props}>
      <path
        d="m4.5 5.5 15 6.5-15 6.5 2-6.5-2-6.5Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M6.5 12h7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export default function Home() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<BookingState>({});
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: initialGreeting,
    },
  ]);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsStatus, setTtsStatus] = useState("Tap mic to start the free voice");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef(input);
  const loadingRef = useRef(loading);
  const stateRef = useRef(state);
  const messagesRef = useRef(messages);
  const transcriptRef = useRef(transcript);
  const finalTranscriptRef = useRef("");
  const isListeningRef = useRef(isListening);
  const isSpeakingRef = useRef(isSpeaking);
  const autoSendOnEndRef = useRef(false);
  const autoRestartCountRef = useRef(0);
  const hasStartedVoiceFlowRef = useRef(false);
  const speechRunIdRef = useRef(0);
  const sendMessageRef = useRef<(messageText?: string) => Promise<void>>(async () => {});
  const startListeningRef = useRef<() => void>(() => {});

  inputRef.current = input;
  loadingRef.current = loading;
  stateRef.current = state;
  messagesRef.current = messages;
  transcriptRef.current = transcript;
  isListeningRef.current = isListening;
  isSpeakingRef.current = isSpeaking;

  const collectedCount = useMemo(
    () => bookingFields.filter((field) => state[field.key]).length,
    [state]
  );
  const progressPercent = Math.round((collectedCount / bookingFields.length) * 100);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const preloadedAudio = STUDIO_VOICE_PROMPT_KEYS.map((key) => {
      const audio = new Audio(getStudioVoiceFilePath(key));
      audio.preload = "auto";
      audio.load();
      return audio;
    });

    return () => {
      preloadedAudio.forEach((audio) => {
        audio.pause();
        audio.src = "";
      });
    };
  }, []);

  const stopCurrentSpeech = useCallback(() => {
    speechRunIdRef.current += 1;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }

    utteranceRef.current = null;

    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    isSpeakingRef.current = false;
    setIsSpeaking(false);
    setTtsStatus(
      hasStartedVoiceFlowRef.current ? "Free voice ready" : "Tap mic to start the free voice"
    );
  }, []);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) {
      setError("Voice capture is not available in this browser. Try typing instead.");
      return;
    }

    if (isListeningRef.current || isSpeakingRef.current || loadingRef.current) {
      return;
    }

    try {
      finalTranscriptRef.current = "";
      transcriptRef.current = "";
      autoSendOnEndRef.current = true;
      recognitionRef.current.start();
    } catch {
      setError("Voice capture is already active.");
    }
  }, []);

  startListeningRef.current = startListening;

  const speakBrowserMessage = useCallback(
    (text: string, listenAfter = true) => {
      stopCurrentSpeech();
      const runId = speechRunIdRef.current;
      const spokenText = prepareTextForSpeech(text);

      if (!spokenText) {
        if (listenAfter) {
          globalThis.setTimeout(() => startListeningRef.current(), 450);
        }
        return;
      }

      if (!("speechSynthesis" in window)) {
        setTtsStatus("Voice unavailable");
        setError("No usable voice output is available in this browser.");

        if (listenAfter) {
          globalThis.setTimeout(() => startListeningRef.current(), 450);
        }
        return;
      }

      const utterance = new SpeechSynthesisUtterance(spokenText);
      const selectedVoice = voiceRef.current;

      if (selectedVoice) {
        utterance.voice = selectedVoice;
        utterance.lang = selectedVoice.lang;
      } else {
        utterance.lang = "en-US";
      }

      utterance.rate = 0.97;
      utterance.pitch = 1;
      utterance.volume = 1;
      utteranceRef.current = utterance;
      hasStartedVoiceFlowRef.current = true;
      setError("");
      setTtsStatus("Starting browser voice");

      utterance.onstart = () => {
        if (runId !== speechRunIdRef.current) {
          return;
        }

        isSpeakingRef.current = true;
        setIsSpeaking(true);
        setTtsStatus("Speaking");
      };

      utterance.onend = () => {
        if (runId !== speechRunIdRef.current) {
          return;
        }

        utteranceRef.current = null;
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        setTtsStatus("Free voice ready");

        if (listenAfter) {
          globalThis.setTimeout(() => startListeningRef.current(), 450);
        }
      };

      utterance.onerror = () => {
        if (runId !== speechRunIdRef.current) {
          return;
        }

        utteranceRef.current = null;
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        setTtsStatus("Free voice ready");
        setError("Free voice audio was unavailable, and browser voice could not start.");

        if (listenAfter) {
          globalThis.setTimeout(() => startListeningRef.current(), 450);
        }
      };

      try {
        window.speechSynthesis.speak(utterance);
      } catch {
        utteranceRef.current = null;
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        setTtsStatus("Free voice ready");
        setError("Free voice audio was unavailable, and browser voice could not start.");

        if (listenAfter) {
          globalThis.setTimeout(() => startListeningRef.current(), 450);
        }
      }
    },
    [stopCurrentSpeech]
  );

  const playStudioPrompt = useCallback(
    (audioKey: StudioVoicePromptKey, fallbackText: string, listenAfter = true) => {
      stopCurrentSpeech();
      const runId = speechRunIdRef.current;
      const audioPath = getStudioVoiceFilePath(audioKey);
      const audio = new Audio(audioPath);

      audioRef.current = audio;
      audio.preload = "auto";
      hasStartedVoiceFlowRef.current = true;
      setError("");
      setTtsStatus("Starting free voice");

      audio.onplaying = () => {
        if (runId !== speechRunIdRef.current) {
          return;
        }

        isSpeakingRef.current = true;
        setIsSpeaking(true);
        setTtsStatus("Speaking");
      };

      audio.onended = () => {
        if (runId !== speechRunIdRef.current) {
          return;
        }

        audioRef.current = null;
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        setTtsStatus("Free voice ready");

        if (listenAfter) {
          globalThis.setTimeout(() => startListeningRef.current(), 450);
        }
      };

      audio.onerror = () => {
        if (runId !== speechRunIdRef.current) {
          return;
        }

        audioRef.current = null;
        speakBrowserMessage(fallbackText, listenAfter);
      };

      audio
        .play()
        .catch(() => {
          if (runId !== speechRunIdRef.current) {
            return;
          }

          audioRef.current = null;
          speakBrowserMessage(fallbackText, listenAfter);
        });
    },
    [speakBrowserMessage, stopCurrentSpeech]
  );

  const handleVoiceButton = useCallback(() => {
    setError("");

    if (!hasStartedVoiceFlowRef.current) {
      playStudioPrompt("intro", STUDIO_VOICE_PROMPTS.intro);
      return;
    }

    startListening();
  }, [playStudioPrompt, startListening]);

  const previewVoice = useCallback(() => {
    playStudioPrompt("preview", STUDIO_VOICE_PROMPTS.preview, false);
  }, [playStudioPrompt]);

  const sendMessage = useCallback(
    async (messageText?: string) => {
      const text = (messageText || inputRef.current).trim();

      if (!text || loadingRef.current) {
        return;
      }

      const nextMessages: Message[] = [
        ...messagesRef.current,
        { role: "user", content: text },
      ];
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
      inputRef.current = "";
      transcriptRef.current = "";
      finalTranscriptRef.current = "";
      setInput("");
      setTranscript("");
      loadingRef.current = true;
      setLoading(true);
      setError("");

      try {
        const response = await fetch("/api/concierge", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: text,
            state: stateRef.current,
          }),
        });

        const data = (await response.json()) as ConciergeResponse;

        if (!response.ok) {
          throw new Error(data.error || "Request failed");
        }

        if (data.extracted) {
          const nextState = {
            ...stateRef.current,
            ...data.extracted,
          };
          stateRef.current = nextState;
          setState(nextState);
        }

        const replyText = data.reply || "Got it. What should I collect next?";

        const nextAssistantMessages: Message[] = [
          ...messagesRef.current,
          {
            role: "assistant",
            content: replyText,
          },
        ];
        messagesRef.current = nextAssistantMessages;
        setMessages(nextAssistantMessages);

        if (data.audioKey) {
          playStudioPrompt(data.audioKey, replyText, !data.done);
        } else {
          speakBrowserMessage(replyText, !data.done);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Something went wrong";
        const replyText = `I could not process that yet. ${message}`;
        setError(message);
        const nextAssistantMessages: Message[] = [
          ...messagesRef.current,
          {
            role: "assistant",
            content: replyText,
          },
        ];
        messagesRef.current = nextAssistantMessages;
        setMessages(nextAssistantMessages);
        speakBrowserMessage(replyText);
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [playStudioPrompt, speakBrowserMessage]
  );

  sendMessageRef.current = sendMessage;

  useEffect(() => {
    if (!("speechSynthesis" in window)) {
      return;
    }

    const syncVoices = () => {
      voiceRef.current = pickPreferredVoice(window.speechSynthesis.getVoices());
    };

    syncVoices();
    window.speechSynthesis.addEventListener("voiceschanged", syncVoices);

    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", syncVoices);
    };
  }, []);

  useEffect(() => {
    const SpeechRecognitionApi =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionApi) {
      setError("Voice capture is not available in this browser. Typed chat still works.");
      return;
    }

    const recognition = new SpeechRecognitionApi();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      isListeningRef.current = true;
      setIsListening(true);
      setTranscript("");
      setError("");
    };

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";

      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        const resultText = result[0].transcript;

        if (result.isFinal) {
          finalText += resultText;
        } else {
          interimText += resultText;
        }
      }

      const visibleTranscript = (finalText || interimText).trim();
      finalTranscriptRef.current = finalText.trim();
      transcriptRef.current = visibleTranscript;
      setTranscript(visibleTranscript);
      setInput(visibleTranscript);
    };

    recognition.onerror = (event) => {
      autoSendOnEndRef.current = false;
      isListeningRef.current = false;
      const message =
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "Microphone access is blocked. Allow microphone access, then tap the mic again."
          : `Voice capture error: ${event.error}`;
      setError(message);
      setIsListening(false);
    };

    recognition.onend = () => {
      isListeningRef.current = false;
      setIsListening(false);

      if (!autoSendOnEndRef.current) {
        return;
      }

      autoSendOnEndRef.current = false;
      const text = (finalTranscriptRef.current || transcriptRef.current).trim();

      if (text) {
        autoRestartCountRef.current = 0;
        void sendMessageRef.current(text);
        return;
      }

      if (autoRestartCountRef.current < 1) {
        autoRestartCountRef.current += 1;
        setError("I did not catch that. Listening again.");
        globalThis.setTimeout(() => startListeningRef.current(), 700);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.stop();
      } catch {
        // Ignore cleanup errors from inactive speech recognition sessions.
      }
      stopCurrentSpeech();
    };
  }, [stopCurrentSpeech]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#07100d] text-white">
      <video
        aria-hidden="true"
        className="fixed inset-0 h-full w-full object-cover"
        src="/back.mp4"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
      />
      <div className="fixed inset-0 bg-black/55" />

      <div className="relative z-10 flex min-h-screen flex-col px-4 py-4 sm:px-6">
        <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
          <div className="flex items-center gap-3 font-semibold tracking-normal">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-sm text-[#0b1713]">
              AI
            </span>
            <span>AI Frontdesk</span>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <span className="hidden shrink-0 rounded-lg border border-white/20 bg-white/15 px-3 py-1 text-xs font-semibold text-white backdrop-blur sm:inline-flex">
              {STUDIO_VOICE_PACK_LABEL}
            </span>
            <span
              className={`shrink-0 rounded-lg border border-white/20 px-3 py-1 text-xs font-semibold backdrop-blur ${
                isListening
                  ? "bg-[#d9ecff]/90 text-[#134d86]"
                  : isSpeaking
                    ? "bg-[#ffe9b8]/90 text-[#724500]"
                    : "bg-white/15 text-white"
              }`}
            >
              {isListening ? "Listening" : isSpeaking ? "Speaking" : ttsStatus}
            </span>
          </div>
        </header>

        <section className="flex flex-1 items-center justify-center py-6">
          <div
            id="demo"
            className="flex h-[min(78vh,760px)] w-full max-w-3xl flex-col rounded-2xl border border-white/18 bg-[#07100d]/72 shadow-2xl shadow-black/30 backdrop-blur-xl"
            aria-label="AI Frontdesk chat"
          >
            <div className="border-b border-white/12 px-4 py-4 sm:px-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-xl font-semibold tracking-normal text-white sm:text-2xl">
                    AI Frontdesk
                  </h1>
                  <p className="mt-1 text-sm text-white/68">
                    Voice booking concierge for ski rental guests.
                  </p>
                </div>
                <div className="min-w-20 text-right">
                  <div className="text-sm font-semibold text-white">
                    {progressPercent}%
                  </div>
                  <div className="text-xs text-white/60">captured</div>
                </div>
              </div>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/14">
                <div
                  className="h-full rounded-full bg-[#91d8bf] transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
              <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
                {messages.map((message, index) => (
                  <div
                    key={`${message.role}-${index}`}
                    className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm sm:max-w-[78%] ${
                        message.role === "user"
                          ? "bg-white text-[#101916]"
                          : "bg-white/12 text-white ring-1 ring-white/12"
                      }`}
                    >
                      {message.content}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl bg-white/12 px-4 py-3 text-sm font-medium text-white/72 ring-1 ring-white/12">
                      Thinking...
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            <div className="border-t border-white/12 px-4 py-4 sm:px-5">
              <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
                {bookingFields.map((field) => (
                  <div
                    key={field.key}
                    className={`min-w-0 rounded-lg border px-2 py-2 ${
                      state[field.key]
                        ? "border-[#91d8bf]/50 bg-[#91d8bf]/18"
                        : "border-white/12 bg-white/8"
                    }`}
                  >
                    <div className="truncate text-[11px] font-semibold uppercase text-white/54">
                      {field.label}
                    </div>
                    <div className="mt-1 truncate text-xs font-semibold text-white">
                      {state[field.key] || field.hint}
                    </div>
                  </div>
                ))}
              </div>

              {transcript && (
                <div className="mb-3 rounded-lg border border-[#91d8bf]/35 bg-[#91d8bf]/14 px-3 py-2 text-sm text-white">
                  Captured voice: {transcript}
                </div>
              )}
              {error && (
                <div className="mb-3 rounded-lg border border-[#ffb5a5]/35 bg-[#7d1f14]/35 px-3 py-2 text-sm text-[#ffd7ce]">
                  {error}
                </div>
              )}

              <div className="mb-3 flex items-center gap-2 rounded-xl border border-white/16 bg-white/10 px-3 py-2 text-sm text-white/80">
                <span className="min-w-0 flex-1 truncate">{STUDIO_VOICE_PACK_LABEL}</span>
                <button
                  type="button"
                  onClick={previewVoice}
                  disabled={isListening || isSpeaking}
                  className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-white/16 bg-white/12 px-4 text-sm font-medium text-white transition hover:bg-white/18 disabled:cursor-not-allowed disabled:bg-white/8 disabled:text-white/45"
                >
                  Preview
                </button>
              </div>

              <div className="flex items-center gap-2 rounded-2xl border border-white/16 bg-white/12 p-2 shadow-lg backdrop-blur">
                <button
                  type="button"
                  onClick={handleVoiceButton}
                  disabled={isListening || isSpeaking || loading}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-[#0b1713] transition hover:bg-[#eef7f3] disabled:cursor-not-allowed disabled:bg-white/35 disabled:text-white/70"
                  aria-label={
                    hasStartedVoiceFlowRef.current
                      ? "Start voice capture"
                      : "Speak the greeting and start voice capture"
                  }
                  title={
                    hasStartedVoiceFlowRef.current
                      ? "Start voice capture"
                      : "Speak the greeting and start voice capture"
                  }
                >
                  <MicIcon className="h-5 w-5" />
                </button>
                <input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void sendMessage();
                    }
                  }}
                  placeholder="Message AI Frontdesk..."
                  className="min-w-0 flex-1 bg-transparent px-2 text-sm text-white outline-none placeholder:text-white/52"
                />
                <button
                  type="button"
                  onClick={() => void sendMessage()}
                  disabled={loading || !input.trim()}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#91d8bf] text-[#0b1713] transition hover:bg-[#b5ead8] disabled:cursor-not-allowed disabled:bg-white/25 disabled:text-white/60"
                  aria-label="Send message"
                  title="Send message"
                >
                  <SendIcon className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
