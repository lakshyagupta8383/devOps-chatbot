"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatReference,
  ChatRole,
  DevOpsIncident,
  SolutionEvaluation,
} from "@/lib/incident-types";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  references: ChatReference[];
  at: string;
};

type IncidentApiResponse = {
  incident: DevOpsIncident;
  source?: "fallback";
};

type ChatApiResponse = {
  reply?: string;
  references?: ChatReference[];
  source?: string;
  model?: string;
};

type EvaluationApiResponse = {
  evaluation?: SolutionEvaluation;
  source?: string;
};

type IncidentPanelData = {
  serviceName: string;
  errorRate: string;
  region: string;
  time: string;
};

type ChatInterfaceProps = {
  onIncidentLoaded?: (incident: IncidentPanelData) => void;
};

type ScenarioMode = "loading" | "ai" | "fallback" | "error";
type GuidanceMode = "model" | "grounded" | "fallback";

const QUICK_PROMPTS = [
  "Give me logs and metrics",
  "What should I check first?",
  "My diagnosis is Redis saturation. Am I missing anything?",
];

export default function ChatInterface({ onIncidentLoaded }: ChatInterfaceProps) {
  // Hidden scenario state: used for guidance and evaluation, not rendered directly.
  const [incident, setIncident] = useState<DevOpsIncident | null>(null);
  const [finalEvaluation, setFinalEvaluation] = useState<SolutionEvaluation | null>(
    null,
  );
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    buildStartupMessages(),
  );
  const [input, setInput] = useState("");
  const [loadingIncident, setLoadingIncident] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [incidentError, setIncidentError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [scenarioMode, setScenarioMode] = useState<ScenarioMode>("loading");
  const [guidanceMode, setGuidanceMode] = useState<GuidanceMode>("model");

  const loadedRef = useRef(false);
  const conversationRef = useRef<HTMLDivElement | null>(null);

  const chatLocked = Boolean(finalEvaluation);
  const showPromptChips = !chatLocked && !!incident && messages.length <= 2;

  useEffect(() => {
    if (loadedRef.current) {
      return;
    }
    loadedRef.current = true;
    void startNewScenario();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!conversationRef.current) {
      return;
    }
    conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
  }, [messages, isProcessing, finalEvaluation]);

  const inputPlaceholder = useMemo(() => {
    if (loadingIncident) {
      return "Preparing scenario...";
    }
    if (scenarioMode === "error") {
      return "Scenario failed to load. Retry scenario.";
    }
    if (chatLocked) {
      return "Evaluation complete. Start a new scenario to continue.";
    }
    return "Ask for logs/metrics or share your diagnosis";
  }, [chatLocked, loadingIncident, scenarioMode]);

  async function startNewScenario() {
    setLoadingIncident(true);
    setIsProcessing(false);
    setIncidentError(null);
    setRequestError(null);
    setFinalEvaluation(null);
    setIncident(null);
    setScenarioMode("loading");
    setGuidanceMode("model");
    setMessages(buildStartupMessages());
    onIncidentLoaded?.({
      serviceName: "loading scenario...",
      errorRate: "--",
      region: "--",
      time: "--",
    });

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
      setScenarioMode(data.source === "fallback" ? "fallback" : "ai");
      onIncidentLoaded?.({
        serviceName: data.incident.serviceName,
        errorRate: data.incident.errorRate,
        region: data.incident.region,
        time: formatIncidentTime(data.incident),
      });

      setMessages((prev) => [
        ...prev,
        makeAssistantMessage(
          "Hidden scenario loaded. Ask for logs/metrics, then share your diagnosis when ready.",
        ),
      ]);
    } catch {
      setIncidentError(
        "Could not initialize scenario. Check model key/network and retry.",
      );
      setScenarioMode("error");
      setMessages((prev) => [
        ...prev,
        makeAssistantMessage(
          "Scenario initialization failed. Use Retry Scenario once connectivity is restored.",
        ),
      ]);
      onIncidentLoaded?.({
        serviceName: "unavailable",
        errorRate: "--",
        region: "--",
        time: "--",
      });
    } finally {
      setLoadingIncident(false);
    }
  }

  function handleQuickPromptClick(prompt: string) {
    setInput(prompt);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (chatLocked || loadingIncident || isProcessing) {
      return;
    }

    const userInput = input.trim();
    if (!userInput) {
      return;
    }

    const nextUserMessage = makeUserMessage(userInput);
    const nextHistory = [...messages, nextUserMessage];
    setInput("");
    setRequestError(null);
    setMessages((prev) => [...prev, nextUserMessage]);

    if (!incident) {
      setRequestError("Scenario is not ready yet. Retry after loading.");
      setMessages((prev) => [
        ...prev,
        makeAssistantMessage("Scenario is still loading. Please retry in a moment."),
      ]);
      return;
    }

    if (shouldTriggerEvaluation(userInput)) {
      void handleEvaluation(userInput, incident);
      return;
    }

    void handleGuidance(incident, nextHistory);
  }

  async function handleGuidance(incidentData: DevOpsIncident, history: ChatMessage[]) {
    setIsProcessing(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          incident: incidentData,
          history: history.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`Chat request failed (${response.status})`);
      }

      const data = (await response.json()) as ChatApiResponse;
      if (data.source === "grounded-incident-data") {
        setGuidanceMode("grounded");
      } else if (data.source === "fallback") {
        setGuidanceMode("fallback");
      } else {
        setGuidanceMode("model");
      }
      const assistantReply =
        typeof data.reply === "string" && data.reply.trim()
          ? data.reply.trim()
          : buildFallbackAssistantReply(incidentData);
      const assistantReferences = normalizeReferences(data.references);

      setMessages((prev) => [
        ...prev,
        makeAssistantMessage(assistantReply, assistantReferences),
      ]);
    } catch {
      setGuidanceMode("fallback");
      setRequestError("Guidance model is unavailable. Returned local fallback guidance.");
      setMessages((prev) => [
        ...prev,
        makeAssistantMessage(
          buildFallbackAssistantReply(incidentData),
          buildFallbackReferences(incidentData),
        ),
      ]);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleEvaluation(userInput: string, incidentData: DevOpsIncident) {
    setIsProcessing(true);
    try {
      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          incident: incidentData,
          userAnswer: userInput,
        }),
      });

      if (!response.ok) {
        throw new Error(`Evaluation request failed (${response.status})`);
      }

      const data = (await response.json()) as EvaluationApiResponse;
      if (data.source === "fallback") {
        setGuidanceMode("fallback");
      }
      const evaluation =
        data.evaluation ?? buildClientFallbackEvaluation(userInput, incidentData);

      setFinalEvaluation(evaluation);
      setMessages((prev) => [...prev, makeAssistantMessage(buildEvaluationSummaryMessage(evaluation))]);
    } catch {
      setRequestError("Evaluation model unavailable. Used local fallback scoring.");
      const fallback = buildClientFallbackEvaluation(userInput, incidentData);
      setFinalEvaluation(fallback);
      setMessages((prev) => [...prev, makeAssistantMessage(buildEvaluationSummaryMessage(fallback))]);
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <div className="flex h-full min-h-[420px] flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
        <span className="rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-cyan-100">
          {formatScenarioMode(scenarioMode)}
        </span>
        <span className="rounded border border-fuchsia-500/40 bg-fuchsia-500/10 px-2 py-1 text-fuchsia-100">
          {chatLocked
            ? "Session: evaluated"
            : isProcessing
              ? "Session: active task"
              : `Guidance: ${formatGuidanceMode(guidanceMode)}`}
        </span>
      </div>

      {incidentError ? (
        <div className="mb-3 rounded-md border border-red-500/35 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {incidentError}
        </div>
      ) : null}

      {requestError ? (
        <div className="mb-3 rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {requestError}
        </div>
      ) : null}

      {showPromptChips ? (
        <div className="mb-3 flex flex-wrap gap-2">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => handleQuickPromptClick(prompt)}
              className="rounded border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 text-xs text-violet-100 transition-colors hover:border-cyan-400/60 hover:text-cyan-100"
            >
              {prompt}
            </button>
          ))}
        </div>
      ) : null}

      <div
        ref={conversationRef}
        className="flex-1 space-y-3 overflow-y-auto rounded-md border border-dashed border-cyan-500/30 bg-[#0a0822] p-3"
      >
        {loadingIncident ? (
          <div className="space-y-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-zinc-800" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-zinc-800" />
          </div>
        ) : null}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`max-w-[92%] rounded-md border px-3 py-2 text-sm leading-6 ${
              message.role === "user"
                ? "ml-auto border-cyan-400/40 bg-cyan-500/10 text-cyan-100"
                : "mr-auto border-violet-500/35 bg-violet-500/10 text-violet-50"
            }`}
          >
            <p>{message.content}</p>
            {message.role === "assistant" && message.references.length ? (
              <div className="mt-2 rounded border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-2">
                <p className="text-[10px] uppercase tracking-[0.14em] text-cyan-100">
                  References
                </p>
                <ul className="mt-1 space-y-1">
                  {message.references.map((reference) => (
                    <li key={`${message.id}-${reference.id}`} className="text-[11px] leading-5 text-cyan-100/90">
                      <span className="font-semibold">{reference.label}:</span>{" "}
                      <span className="text-cyan-50/90">{reference.evidence}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-zinc-500">
              {formatTimeLabel(message.at)}
            </p>
          </div>
        ))}

        {isProcessing ? (
          <div className="mr-auto inline-flex items-center gap-2 rounded-md border border-cyan-500/35 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-100">
            <span className="h-2 w-2 animate-pulse rounded-full bg-fuchsia-400" />
            Assistant analyzing...
          </div>
        ) : null}
      </div>

      <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={inputPlaceholder}
          disabled={loadingIncident || isProcessing || chatLocked}
          className="h-11 flex-1 rounded-md border border-cyan-500/35 bg-[#140e2d] px-3 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-500 focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={loadingIncident || isProcessing || chatLocked || !input.trim()}
          className="h-11 rounded-md border border-fuchsia-500/45 bg-fuchsia-500/15 px-4 text-sm font-medium text-fuchsia-100 transition-colors enabled:hover:bg-fuchsia-500/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
        <button
          type="button"
          onClick={() => void startNewScenario()}
          disabled={loadingIncident || isProcessing}
          className="h-11 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 text-xs font-medium text-cyan-100 transition-colors enabled:hover:border-cyan-300 enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          New Scenario
        </button>
      </form>

      {finalEvaluation && incident ? (
        <section className="mt-3 rounded-md border border-orange-500/35 bg-orange-500/10 p-3 text-sm">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-orange-100">
            Final Evaluation
          </h3>
          <div className="mb-2 flex items-center justify-between rounded border border-orange-500/30 bg-[#2b1608] px-3 py-2">
            <span className="text-zinc-400">Verdict</span>
            <span className="font-semibold text-zinc-100">
              {formatVerdict(finalEvaluation.verdict)}
            </span>
          </div>
          <div className="mb-2 flex items-center justify-between rounded border border-orange-500/30 bg-[#2b1608] px-3 py-2">
            <span className="text-zinc-400">Score</span>
            <span className="font-semibold text-zinc-100">
              {finalEvaluation.score}/10
            </span>
          </div>
          <div className="mb-2 rounded border border-orange-500/30 bg-[#2b1608] px-3 py-2">
            <p className="mb-1 text-zinc-400">Explanation</p>
            <p className="text-zinc-100">{finalEvaluation.explanation}</p>
          </div>
          {finalEvaluation.whatMissed.length ? (
            <div className="mb-2 rounded border border-orange-500/30 bg-[#2b1608] px-3 py-2">
              <p className="mb-1 text-zinc-400">What You Missed</p>
              <ul className="list-disc space-y-1 pl-4 text-zinc-100">
                {finalEvaluation.whatMissed.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="rounded border border-orange-500/30 bg-[#2b1608] px-3 py-2">
            <p className="mb-1 text-zinc-400">Correct Solution</p>
            <p className="text-zinc-100">{incident.finalSolution}</p>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function shouldTriggerEvaluation(text: string): boolean {
  return /\b(fix|solution|root cause|diagnosis)\b/i.test(text);
}

function buildFallbackAssistantReply(incident: DevOpsIncident): string {
  const logHint = incident.logs[0];
  const stepHint = incident.correctDebuggingSteps[0];
  return [
    "Keep this investigation hypothesis-driven.",
    `- log clue: ${logHint}`,
    `- next check: ${stepHint}`,
    "What evidence would prove or disprove your current diagnosis?",
  ].join("\n");
}

function buildEvaluationSummaryMessage(evaluation: SolutionEvaluation): string {
  return `Final evaluation complete. Verdict: ${formatVerdict(
    evaluation.verdict,
  )}. Score: ${evaluation.score}/10.`;
}

function formatVerdict(verdict: SolutionEvaluation["verdict"]): string {
  if (verdict === "correct") {
    return "Correct";
  }
  if (verdict === "partially correct") {
    return "Partial";
  }
  return "Wrong";
}

function buildClientFallbackEvaluation(
  userAnswer: string,
  incident: DevOpsIncident,
): SolutionEvaluation {
  const userTokens = extractKeywords(userAnswer);
  const solutionTokens = extractKeywords(incident.finalSolution);
  const issueTokens = extractKeywords(incident.issue);

  const solutionOverlap = overlapRatio(userTokens, solutionTokens);
  const issueOverlap = overlapRatio(userTokens, issueTokens);

  const score = clamp(
    Math.round((solutionOverlap * 0.7 + issueOverlap * 0.3) * 10),
    0,
    10,
  );
  let verdict: SolutionEvaluation["verdict"] = "incorrect";
  if (score >= 8) {
    verdict = "correct";
  } else if (score >= 5) {
    verdict = "partially correct";
  }

  const whatMissed = collectMissedItems(userTokens, incident);
  const explanation =
    verdict === "correct"
      ? "Your answer is strong and technically aligned with the incident mechanics."
      : verdict === "partially correct"
        ? "Your answer is directionally right but misses key remediation/validation detail."
        : "Your answer does not sufficiently match the incident root behavior and recovery plan.";

  return {
    verdict,
    explanation,
    whatMissed,
    score,
  };
}

function collectMissedItems(
  userTokens: Set<string>,
  incident: DevOpsIncident,
): string[] {
  const missed: string[] = [];
  for (const step of incident.correctDebuggingSteps.slice(0, 3)) {
    const stepTokens = extractKeywords(step);
    if (overlapRatio(userTokens, stepTokens) < 0.2) {
      missed.push(step);
    }
  }
  if (overlapRatio(userTokens, extractKeywords(incident.issue)) < 0.25) {
    missed.push("Root-cause alignment with observed failure signals is weak.");
  }
  return missed.slice(0, 4);
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

  const stopWords = new Set([
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

  const tokens = normalized
    .split(" ")
    .filter((token) => token.length >= 3 && !stopWords.has(token));
  return new Set(tokens);
}

function overlapRatio(source: Set<string>, target: Set<string>): number {
  if (!target.size) {
    return 0;
  }
  let overlap = 0;
  for (const token of target) {
    if (source.has(token)) {
      overlap += 1;
    }
  }
  return overlap / target.size;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function buildStartupMessages(): ChatMessage[] {
  return [
    makeAssistantMessage(
      "Incident simulator ready. Generating a hidden scenario...",
    ),
  ];
}

function formatScenarioMode(mode: ScenarioMode): string {
  if (mode === "loading") {
    return "Scenario: preparing";
  }
  if (mode === "fallback") {
    return "Scenario: fallback dataset";
  }
  if (mode === "error") {
    return "Scenario: unavailable";
  }
  return "Scenario: AI-generated";
}

function formatGuidanceMode(mode: GuidanceMode): string {
  if (mode === "grounded") {
    return "grounded data";
  }
  if (mode === "fallback") {
    return "local fallback";
  }
  return "model";
}

function formatIncidentTime(incident: DevOpsIncident): string {
  const firstLogLine = incident.logs[0];
  if (!firstLogLine) {
    return "--";
  }

  const timestampMatch = firstLogLine.match(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z/,
  );
  if (!timestampMatch) {
    return "--";
  }

  const timestamp = new Date(timestampMatch[0]);
  if (Number.isNaN(timestamp.getTime())) {
    return "--";
  }

  const hours = String(timestamp.getUTCHours()).padStart(2, "0");
  const minutes = String(timestamp.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes} UTC`;
}

function isoNow(): string {
  return new Date().toISOString();
}

function formatTimeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }

  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function normalizeReferences(value: unknown): ChatReference[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const references: ChatReference[] = [];
  for (const entry of value) {
    if (!isReference(entry)) {
      continue;
    }
    references.push({
      id: entry.id.trim(),
      source: entry.source,
      label: entry.label.trim(),
      evidence: entry.evidence.trim(),
    });
  }

  const deduped: ChatReference[] = [];
  const seen = new Set<string>();
  for (const reference of references) {
    const key = `${reference.id}::${reference.evidence}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(reference);
  }

  return deduped.slice(0, 6);
}

function isReference(value: unknown): value is ChatReference {
  if (!isObject(value)) {
    return false;
  }
  const allowedSources = new Set([
    "incident-log",
    "incident-symptom",
    "incident-debug-step",
    "incident-metric",
    "knowledge-base",
    "fallback",
  ]);
  return (
    typeof value.id === "string" &&
    typeof value.source === "string" &&
    typeof value.label === "string" &&
    typeof value.evidence === "string" &&
    allowedSources.has(value.source) &&
    value.id.trim().length > 0 &&
    value.label.trim().length > 0 &&
    value.evidence.trim().length > 0
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildFallbackReferences(incident: DevOpsIncident): ChatReference[] {
  const references: ChatReference[] = [];
  if (incident.logs[0]) {
    references.push({
      id: "incident.logs[0]",
      source: "fallback",
      label: "Primary log signal",
      evidence: incident.logs[0],
    });
  }
  if (incident.correctDebuggingSteps[0]) {
    references.push({
      id: "incident.correctDebuggingSteps[0]",
      source: "fallback",
      label: "Primary debugging step",
      evidence: incident.correctDebuggingSteps[0],
    });
  }
  return references;
}

function makeAssistantMessage(
  content: string,
  references: ChatReference[] = [],
): ChatMessage {
  return {
    id: `assistant-${Math.random().toString(36).slice(2, 10)}`,
    role: "assistant",
    content,
    references,
    at: isoNow(),
  };
}

function makeUserMessage(content: string): ChatMessage {
  return {
    id: `user-${Math.random().toString(36).slice(2, 10)}`,
    role: "user",
    content,
    references: [],
    at: isoNow(),
  };
}
