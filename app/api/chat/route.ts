import type {
  ChatReference,
  ChatTurn,
  DevOpsIncident,
} from "@/lib/incident-types";
import { generateGeminiText } from "@/lib/gemini";
import {
  retrieveKnowledgeSnippets,
  type KnowledgeSnippet,
} from "@/lib/knowledge-base";

export const dynamic = "force-dynamic";

const SYSTEM_PROMPT =
  "You are a senior DevOps engineer guiding a junior through a live production incident.";

type ChatReplySource = "model" | "grounded-incident-data" | "fallback";

type ChatReplyPayload = {
  reply: string;
  references: ChatReference[];
  source: ChatReplySource;
  model?: string;
};

type ReferenceCatalogItem = {
  id: string;
  label: string;
  evidence: string;
  source: ChatReference["source"];
};

type ModelReference = {
  id: string;
  label: string;
  evidence: string;
};

export async function POST(request: Request) {
  let incidentForFallback: DevOpsIncident | null = null;
  let historyForFallback: ChatTurn[] = [];

  try {
    const payload = (await request.json()) as unknown;
    const incident = readIncident(payload);
    const history = readHistory(payload);
    incidentForFallback = incident;
    historyForFallback = history;

    if (!history.length) {
      return Response.json(
        { error: "Conversation history is required." },
        { status: 400 },
      );
    }

    const latestUserMessage = getLatestUserMessage(history);
    if (latestUserMessage) {
      const asksForData = detectDataRequest(latestUserMessage);
      if (asksForData.wantsLogs || asksForData.wantsMetrics) {
        const groundedDataResponse = buildGroundedDataResponse(incident, asksForData);
        return Response.json(
          groundedDataResponse,
          {
            headers: {
              "Cache-Control": "no-store, max-age=0",
            },
          },
        );
      }
    }

    const guidance = await createGuidanceReply(incident, history);
    return Response.json(
      guidance,
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    console.error("Chat handler failed.", error);

    if (incidentForFallback && historyForFallback.length) {
      const fallback = buildFallbackResponse(incidentForFallback, historyForFallback);
      return Response.json(
        fallback,
        {
          status: 200,
          headers: {
            "Cache-Control": "no-store, max-age=0",
          },
        },
      );
    }

    return Response.json(
      {
        reply:
          "I cannot reach the guidance model right now. Start by confirming blast radius, checking dependency health, and validating one hypothesis at a time.",
        references: [],
        source: "fallback",
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }
}

async function createGuidanceReply(
  incident: DevOpsIncident,
  history: ChatTurn[],
): Promise<ChatReplyPayload> {
  const hasGeminiKey = Boolean(
    process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
  );
  if (!hasGeminiKey) {
    return buildFallbackResponse(incident, history);
  }

  const model =
    process.env.GEMINI_CHAT_MODEL ??
    process.env.GEMINI_MODEL ??
    "gemini-2.0-flash";
  const baseUrl = process.env.GEMINI_API_URL;
  const retrievalQuery = `${getLatestUserMessage(history) ?? ""}\n${formatHistory(history)}`;
  const knowledgeSnippets = retrieveKnowledgeSnippets(retrievalQuery, 3);
  const referenceCatalog = buildReferenceCatalog(incident, knowledgeSnippets);

  const modelText = await generateGeminiText({
    model,
    baseUrl,
    temperature: 0.4,
    maxOutputTokens: 420,
    systemInstruction: [
      SYSTEM_PROMPT,
      "",
      "Behavior rules:",
      "- You have access to the full incident details.",
      "- Do not reveal the root cause directly.",
      "- Never hallucinate logs or metrics.",
      "- If asked for logs or metrics, return only data grounded in the incident JSON.",
      "- Provide realistic logs, hints, and guidance based on incident context.",
      "- Encourage debugging thinking and hypothesis-driven investigation.",
      "- If the user is on the wrong path, subtly redirect.",
      "- Ask at least one probing question.",
      "- Keep responses concise, technical, and practical.",
      "- Return valid JSON only.",
    ].join("\n"),
    prompt: [
      "Incident JSON:",
      JSON.stringify(incident, null, 2),
      "",
      "Conversation history (oldest to newest):",
      formatHistory(history),
      "",
      "Return JSON only in this exact schema:",
      JSON.stringify(
        {
          reply: "assistant response text",
          references: [
            {
              id: "reference id from the catalog",
              label: "short reference label",
              evidence: "exact supporting signal",
            },
          ],
        },
        null,
        2,
      ),
      "",
      "Rules for references:",
      "- Include 1 to 4 references.",
      "- references[].id must match an id from the Reference Catalog.",
      "- references[].evidence must match the referenced signal content.",
      "",
      "Reference Catalog:",
      formatReferenceCatalog(referenceCatalog),
      "",
      "Retrieved runbook knowledge (ground your response in this scope):",
      formatKnowledgeSnippets(knowledgeSnippets),
    ].join("\n"),
  });
  const structured = parseModelGuidance(modelText);
  const references = resolveModelReferences(structured.references, referenceCatalog);

  if (revealsHiddenAnswer(structured.reply, incident)) {
    return buildFallbackResponse(incident, history);
  }

  return {
    reply: structured.reply,
    references,
    source: "model",
    model,
  };
}

function buildFallbackReply(incident: DevOpsIncident, history: ChatTurn[]): string {
  const latestUserMessage = [...history]
    .reverse()
    .find((turn) => turn.role === "user")?.content;
  const logHint = incident.logs[0];
  const firstStep = incident.correctDebuggingSteps[0];
  const secondStep = incident.correctDebuggingSteps[1];

  const guidance = [
    "Good direction. Keep this hypothesis-driven:",
    `- Log clue: ${logHint}`,
    `- Next check: ${firstStep}`,
    secondStep ? `- Then verify: ${secondStep}` : null,
    latestUserMessage
      ? `Which metric or trace from your latest idea would confirm or reject it quickly?`
      : "What is your first falsifiable hypothesis based on this log clue?",
  ]
    .filter(Boolean)
    .join("\n");

  return guidance;
}

function buildFallbackResponse(
  incident: DevOpsIncident,
  history: ChatTurn[],
): ChatReplyPayload {
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

  return {
    reply: buildFallbackReply(incident, history),
    references,
    source: "fallback",
  };
}

function getLatestUserMessage(history: ChatTurn[]): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].role === "user") {
      return history[index].content;
    }
  }
  return null;
}

function detectDataRequest(message: string): {
  wantsLogs: boolean;
  wantsMetrics: boolean;
} {
  const lower = message.toLowerCase();
  const compact = lower.replace(/\s+/g, " ").trim();

  const mentionsLogs =
    /\blogs?\b/.test(compact) ||
    /\blog lines?\b/.test(compact) ||
    /\berror logs?\b/.test(compact);
  const mentionsMetrics =
    /\bmetrics?\b/.test(compact) ||
    /\berror rate\b/.test(compact) ||
    /\blatency\b/.test(compact) ||
    /\bthroughput\b/.test(compact) ||
    /\bcpu\b/.test(compact) ||
    /\bmemory\b/.test(compact);

  const isExplicitRequest =
    /\b(show|share|provide|give|send|print|fetch|pull|list)\b/.test(compact) ||
    /\b(can i see|let me see|i need|need the|want the|show me)\b/.test(compact);
  const isDataQuestion =
    /\?/.test(compact) &&
    /\b(can|could|would|what|which|any|please)\b/.test(compact);
  const isShortStandalone =
    /^(logs?|metrics?|log lines?|show logs?|show metrics?|logs and metrics)\??$/.test(
      compact,
    );

  const wantsLogs = mentionsLogs && (isExplicitRequest || isDataQuestion || isShortStandalone);
  const wantsMetrics =
    mentionsMetrics && (isExplicitRequest || isDataQuestion || isShortStandalone);

  return {
    wantsLogs,
    wantsMetrics,
  };
}

function buildGroundedDataResponse(
  incident: DevOpsIncident,
  request: { wantsLogs: boolean; wantsMetrics: boolean },
): ChatReplyPayload {
  const lines: string[] = ["Using only scenario data:"];
  const references: ChatReference[] = [];

  if (request.wantsLogs) {
    lines.push("Logs:");
    for (const [index, log] of incident.logs.entries()) {
      lines.push(`- ${log}`);
      references.push({
        id: `incident.logs[${index}]`,
        source: "incident-log",
        label: `Incident log ${index + 1}`,
        evidence: log,
      });
    }
  }

  if (request.wantsMetrics) {
    lines.push("Metrics/Signals:");
    lines.push(`- service: ${incident.serviceName}`);
    lines.push(`- region: ${incident.region}`);
    lines.push(`- error rate: ${incident.errorRate}`);
    references.push({
      id: "incident.metric.core",
      source: "incident-metric",
      label: "Service/region/error-rate",
      evidence: `${incident.serviceName} | ${incident.region} | ${incident.errorRate}`,
    });
    for (const [index, symptom] of incident.symptoms.entries()) {
      lines.push(`- observed: ${symptom}`);
      references.push({
        id: `incident.symptoms[${index}]`,
        source: "incident-symptom",
        label: `Observed symptom ${index + 1}`,
        evidence: symptom,
      });
    }
  }

  lines.push(
    "Based on these signals, what is your next hypothesis and how would you validate it?",
  );

  return {
    reply: lines.join("\n"),
    references: dedupeReferences(references).slice(0, 6),
    source: "grounded-incident-data",
  };
}

function formatHistory(history: ChatTurn[]): string {
  return history
    .map((turn, index) => `${index + 1}. ${turn.role.toUpperCase()}: ${turn.content}`)
    .join("\n");
}

function formatKnowledgeSnippets(snippets: KnowledgeSnippet[]): string {
  if (!snippets.length) {
    return "- No snippets available.";
  }

  return snippets
    .map(
      (snippet, index) =>
        `${index + 1}. ${snippet.title} (${snippet.scope})\n${snippet.content}`,
    )
    .join("\n\n");
}

function buildReferenceCatalog(
  incident: DevOpsIncident,
  snippets: KnowledgeSnippet[],
): ReferenceCatalogItem[] {
  const catalog: ReferenceCatalogItem[] = [];

  for (const [index, log] of incident.logs.entries()) {
    catalog.push({
      id: `incident.logs[${index}]`,
      label: `Incident log ${index + 1}`,
      evidence: log,
      source: "incident-log",
    });
  }

  for (const [index, symptom] of incident.symptoms.entries()) {
    catalog.push({
      id: `incident.symptoms[${index}]`,
      label: `Observed symptom ${index + 1}`,
      evidence: symptom,
      source: "incident-symptom",
    });
  }

  for (const [index, step] of incident.correctDebuggingSteps.slice(0, 4).entries()) {
    catalog.push({
      id: `incident.correctDebuggingSteps[${index}]`,
      label: `Debug step ${index + 1}`,
      evidence: step,
      source: "incident-debug-step",
    });
  }

  for (const snippet of snippets) {
    catalog.push({
      id: `knowledge.${snippet.id}`,
      label: `Runbook: ${snippet.title}`,
      evidence: snippet.content,
      source: "knowledge-base",
    });
  }

  return catalog;
}

function formatReferenceCatalog(catalog: ReferenceCatalogItem[]): string {
  if (!catalog.length) {
    return "- No references available.";
  }

  return catalog
    .map(
      (item) =>
        `- id: ${item.id}\n  label: ${item.label}\n  source: ${item.source}\n  evidence: ${item.evidence}`,
    )
    .join("\n");
}

function parseModelGuidance(text: string): { reply: string; references: ModelReference[] } {
  const parsed = JSON.parse(extractJson(text)) as unknown;
  if (!isObject(parsed)) {
    throw new Error("Model response is not an object.");
  }

  const reply = readString(parsed, "reply");
  const referencesRaw = parsed.references;
  const references: ModelReference[] = [];

  if (Array.isArray(referencesRaw)) {
    for (const entry of referencesRaw) {
      if (!isObject(entry)) {
        continue;
      }
      const id = typeof entry.id === "string" ? entry.id.trim() : "";
      const label = typeof entry.label === "string" ? entry.label.trim() : "";
      const evidence = typeof entry.evidence === "string" ? entry.evidence.trim() : "";
      if (!id || !evidence) {
        continue;
      }
      references.push({
        id,
        label: label || id,
        evidence,
      });
    }
  }

  return {
    reply,
    references,
  };
}

function resolveModelReferences(
  references: ModelReference[],
  catalog: ReferenceCatalogItem[],
): ChatReference[] {
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const resolved: ChatReference[] = [];

  for (const reference of references) {
    const match = byId.get(reference.id);
    if (!match) {
      continue;
    }

    resolved.push({
      id: match.id,
      source: match.source,
      label: reference.label || match.label,
      evidence: match.evidence,
    });
  }

  const deduped = dedupeReferences(resolved);
  if (deduped.length) {
    return deduped.slice(0, 4);
  }

  return catalog.slice(0, 2).map((entry) => ({
    id: entry.id,
    source: entry.source,
    label: entry.label,
    evidence: entry.evidence,
  }));
}

function dedupeReferences(references: ChatReference[]): ChatReference[] {
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

  return deduped;
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function revealsHiddenAnswer(reply: string, incident: DevOpsIncident): boolean {
  return (
    hasStrongPhraseMatch(reply, incident.issue) ||
    hasStrongPhraseMatch(reply, incident.finalSolution)
  );
}

function hasStrongPhraseMatch(reply: string, secret: string): boolean {
  const normalizedReply = normalizeText(reply);
  const normalizedSecret = normalizeText(secret);
  if (!normalizedReply || !normalizedSecret) {
    return false;
  }

  if (normalizedSecret.length >= 24 && normalizedReply.includes(normalizedSecret)) {
    return true;
  }

  const secretWords = normalizedSecret.split(" ").filter((word) => word.length >= 4);
  if (secretWords.length < 4) {
    return false;
  }

  let overlap = 0;
  for (const word of secretWords) {
    if (normalizedReply.includes(word)) {
      overlap += 1;
    }
  }

  return overlap / secretWords.length >= 0.7;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readIncident(payload: unknown): DevOpsIncident {
  if (!isObject(payload) || !isObject(payload.incident)) {
    throw new Error("Missing incident payload.");
  }

  const incident = payload.incident;
  return {
    serviceName: readString(incident, "serviceName"),
    region: readString(incident, "region"),
    errorRate: readString(incident, "errorRate"),
    issue: readString(incident, "issue"),
    logs: readStringArray(incident, "logs", 3, 6),
    symptoms: readStringArray(incident, "symptoms", 1, 8),
    correctDebuggingSteps: readStringArray(incident, "correctDebuggingSteps", 2, 10),
    finalSolution: readString(incident, "finalSolution"),
  };
}

function readHistory(payload: unknown): ChatTurn[] {
  if (!isObject(payload) || !Array.isArray(payload.history)) {
    throw new Error("Missing conversation history.");
  }

  const turns: ChatTurn[] = [];
  for (const turn of payload.history) {
    if (!isObject(turn)) {
      continue;
    }
    const roleRaw = turn.role;
    const contentRaw = turn.content;
    if (
      (roleRaw === "user" || roleRaw === "assistant") &&
      typeof contentRaw === "string" &&
      contentRaw.trim()
    ) {
      turns.push({
        role: roleRaw,
        content: contentRaw.trim(),
      });
    }
  }

  return turns.slice(-16);
}

function readString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid field: ${key}`);
  }
  return value.trim();
}

function readStringArray(
  obj: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
): string[] {
  const value = obj[key];
  if (!Array.isArray(value)) {
    throw new Error(`Invalid field: ${key}`);
  }

  const clean = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);

  if (clean.length < min || clean.length > max) {
    throw new Error(`Invalid length for field: ${key}`);
  }

  return clean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
