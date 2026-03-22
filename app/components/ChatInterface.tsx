"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatRole,
  DevOpsIncident,
  IncidentEvaluation,
} from "@/lib/incident-types";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

type IncidentApiResponse = {
  incident: DevOpsIncident;
  source?: "fallback";
};

type ChatApiResponse = {
  reply?: string;
};

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "with",
]);

export default function ChatInterface() {
  // Hidden scenario state: stored in React state but never rendered directly.
  const [incident, setIncident] = useState<DevOpsIncident | null>(null);
  const [evaluation, setEvaluation] = useState<IncidentEvaluation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "assistant-0",
      role: "assistant",
      content: "Incident simulator ready. Generating a hidden scenario...",
    },
  ]);
  const [input, setInput] = useState("");
  const [loadingIncident, setLoadingIncident] = useState(true);
  const [isEvaluating, setIsEvaluating] = useState(false);

  const loadedRef = useRef(false);
  const messageCountRef = useRef(0);

  useEffect(() => {
    if (loadedRef.current) {
      return;
    }
    loadedRef.current = true;

    const loadIncident = async () => {
      setLoadingIncident(true);
      try {
        const response = await fetch("/api/incidents/random", {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Failed to load incident (${response.status})`);
        }

        const data = (await response.json()) as IncidentApiResponse;
        setIncident(data.incident);
        setMessages((prev) => [
          ...prev,
          {
            id: nextMessageId(messageCountRef),
            role: "assistant",
            content:
              "Hidden scenario loaded. Share your triage notes, likely root cause, and remediation steps.",
          },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: nextMessageId(messageCountRef),
            role: "assistant",
            content:
              "Scenario loading failed. Refresh and retry once the incident generator is reachable.",
          },
        ]);
      } finally {
        setLoadingIncident(false);
      }
    };

    void loadIncident();
  }, []);

  const inputPlaceholder = useMemo(
    () =>
      loadingIncident
        ? "Loading hidden scenario..."
        : "Describe your diagnosis and recovery plan",
    [loadingIncident],
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const userInput = input.trim();
    if (!userInput) {
      return;
    }

    const nextUserMessage: ChatMessage = {
      id: nextMessageId(messageCountRef),
      role: "user",
      content: userInput,
    };

    const nextHistory = [...messages, nextUserMessage];
    setInput("");
    setMessages((prev) => [...prev, nextUserMessage]);

    if (!incident) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextMessageId(messageCountRef),
          role: "assistant",
          content: "Scenario is still initializing. Submit again in a moment.",
        },
      ]);
      return;
    }

    setIsEvaluating(true);

    const userConversation = nextHistory
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .join(" ");

    const nextEvaluation = evaluateAttempt(userConversation, incident);

    void (async () => {
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            incident,
            history: nextHistory.map((message) => ({
              role: message.role,
              content: message.content,
            })),
          }),
        });

        if (!response.ok) {
          throw new Error(`Chat request failed (${response.status})`);
        }

        const data = (await response.json()) as ChatApiResponse;
        const assistantReply =
          typeof data.reply === "string" && data.reply.trim()
            ? data.reply.trim()
            : buildFallbackAssistantReply(nextEvaluation, incident);

        setEvaluation(nextEvaluation);
        setMessages((prev) => [
          ...prev,
          {
            id: nextMessageId(messageCountRef),
            role: "assistant",
            content: assistantReply,
          },
        ]);
      } catch {
        const fallbackReply = buildFallbackAssistantReply(nextEvaluation, incident);
        setEvaluation(nextEvaluation);
        setMessages((prev) => [
          ...prev,
          {
            id: nextMessageId(messageCountRef),
            role: "assistant",
            content: fallbackReply,
          },
        ]);
      } finally {
        setIsEvaluating(false);
      }
    })();
  }

  return (
    <div className="flex h-full min-h-[280px] flex-col">
      <div className="mb-3 flex items-center justify-between text-xs text-zinc-500">
        <span>{loadingIncident ? "Scenario: loading" : "Scenario: active"}</span>
        <span>{isEvaluating ? "Evaluation: running" : "Evaluation: idle"}</span>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto rounded-md border border-dashed border-zinc-700 bg-[#070b0a] p-3">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`max-w-[90%] rounded-md border px-3 py-2 text-sm leading-6 ${
              message.role === "user"
                ? "ml-auto border-emerald-500/30 bg-emerald-950/30 text-emerald-100"
                : "mr-auto border-zinc-700 bg-zinc-900/60 text-zinc-200"
            }`}
          >
            {message.content}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={inputPlaceholder}
          disabled={loadingIncident}
          className="h-11 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-500 focus:border-emerald-500/60"
        />
        <button
          type="submit"
          disabled={loadingIncident || isEvaluating || !input.trim()}
          className="h-11 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 text-sm font-medium text-emerald-200 transition-colors enabled:hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </form>

      {evaluation ? <span className="sr-only">{evaluation.solved ? "solved" : "in-progress"}</span> : null}
    </div>
  );
}

function evaluateAttempt(text: string, incident: DevOpsIncident): IncidentEvaluation {
  const inputTokens = extractKeywords(text);

  const symptomCoverage = scoreCoverage(inputTokens, incident.symptoms);
  const debuggingCoverage = scoreCoverage(inputTokens, incident.correctDebuggingSteps);
  const rootCauseMentioned = hasStrongMatch(inputTokens, incident.issue);
  const solutionMentioned = hasStrongMatch(inputTokens, incident.finalSolution);
  const solved =
    (rootCauseMentioned || solutionMentioned) &&
    symptomCoverage >= 34 &&
    debuggingCoverage >= 50;

  return {
    symptomCoverage,
    debuggingCoverage,
    rootCauseMentioned,
    solutionMentioned,
    solved,
  };
}

function buildFallbackAssistantReply(
  evaluation: IncidentEvaluation,
  incident: DevOpsIncident,
): string {
  if (evaluation.solved) {
    return "Assessment: your diagnosis matches the hidden incident and the remediation plan is valid. Marking this scenario resolved.";
  }

  const hints: string[] = [];
  const focus = inferFocus(incident);

  if (evaluation.symptomCoverage < 50) {
    hints.push("Start with symptom correlation across latency, error spikes, and retries.");
  }

  if (!evaluation.rootCauseMentioned) {
    hints.push(focus);
  }

  if (evaluation.debuggingCoverage < 60) {
    hints.push("Add concrete verification steps with metrics, logs, and dependency health checks.");
  }

  if (!evaluation.solutionMentioned) {
    hints.push("Finish with one immediate fix and one prevention control.");
  }

  const summary = `Assessment: symptom coverage ${evaluation.symptomCoverage}%, debugging coverage ${evaluation.debuggingCoverage}%.`;
  return `${summary} ${hints.join(" ")}`.trim();
}

function inferFocus(incident: DevOpsIncident): string {
  const issueText = `${incident.issue} ${incident.logs.join(" ")}`.toLowerCase();

  if (issueText.includes("certificate") || issueText.includes("tls")) {
    return "Root cause likely sits in trust, certificate rotation, or handshake paths.";
  }
  if (issueText.includes("redis") || issueText.includes("queue")) {
    return "Root cause likely involves dependency saturation and retry amplification.";
  }
  if (issueText.includes("index") || issueText.includes("lock") || issueText.includes("query")) {
    return "Root cause likely involves database contention or a schema/query regression.";
  }
  if (issueText.includes("dns") || issueText.includes("timeout") || issueText.includes("connection")) {
    return "Root cause likely involves connectivity or upstream timeout behavior.";
  }

  return "Root cause likely involves a recent config/deploy change under production load.";
}

function scoreCoverage(inputTokens: Set<string>, references: string[]): number {
  if (!references.length) {
    return 0;
  }

  let matchedCount = 0;
  for (const reference of references) {
    if (matchesReference(inputTokens, reference)) {
      matchedCount += 1;
    }
  }

  return Math.round((matchedCount / references.length) * 100);
}

function hasStrongMatch(inputTokens: Set<string>, reference: string): boolean {
  const referenceTokens = extractKeywords(reference);
  if (!referenceTokens.size) {
    return false;
  }

  let overlap = 0;
  for (const token of referenceTokens) {
    if (inputTokens.has(token)) {
      overlap += 1;
    }
  }

  const ratio = overlap / referenceTokens.size;
  return overlap >= 2 || ratio >= 0.45;
}

function matchesReference(inputTokens: Set<string>, reference: string): boolean {
  const referenceTokens = extractKeywords(reference);
  if (!referenceTokens.size) {
    return false;
  }

  for (const token of referenceTokens) {
    if (inputTokens.has(token)) {
      return true;
    }
  }
  return false;
}

function extractKeywords(text: string): Set<string> {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return new Set<string>();
  }

  const keywords = normalized
    .split(" ")
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

  return new Set<string>(keywords);
}

function nextMessageId(counterRef: { current: number }): string {
  counterRef.current += 1;
  return `message-${counterRef.current}`;
}
