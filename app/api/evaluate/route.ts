import type { DevOpsIncident, SolutionEvaluation } from "@/lib/incident-types";
import { generateGeminiText } from "@/lib/gemini";

export const dynamic = "force-dynamic";

const EVALUATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: {
      type: "string",
      enum: ["correct", "partially correct", "incorrect"],
    },
    explanation: { type: "string" },
    whatMissed: {
      type: "array",
      items: { type: "string" },
      minItems: 0,
      maxItems: 6,
    },
    score: {
      type: "number",
      minimum: 0,
      maximum: 10,
    },
  },
  required: ["verdict", "explanation", "whatMissed", "score"],
} as const;

export async function POST(request: Request) {
  let incident: DevOpsIncident;
  let userAnswer: string;

  try {
    const payload = (await request.json()) as unknown;
    incident = readIncident(payload);
    userAnswer = readUserAnswer(payload);
  } catch {
    return Response.json(
      { error: "Invalid evaluation payload." },
      { status: 400 },
    );
  }

  try {
    const evaluation = await evaluateWithGemini(userAnswer, incident);
    return Response.json(
      { evaluation },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    console.error("Gemini evaluation failed, using heuristic fallback.", error);
    const fallback = evaluateHeuristically(userAnswer, incident);
    return Response.json(
      {
        evaluation: fallback,
        source: "fallback",
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  }
}

async function evaluateWithGemini(
  userAnswer: string,
  incident: DevOpsIncident,
): Promise<SolutionEvaluation> {
  const hasGeminiKey = Boolean(
    process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
  );
  if (!hasGeminiKey) {
    return evaluateHeuristically(userAnswer, incident);
  }

  const model =
    process.env.GEMINI_EVAL_MODEL ??
    process.env.GEMINI_MODEL ??
    "gemini-2.0-flash";
  const baseUrl = process.env.GEMINI_API_URL;

  const text = await generateGeminiText({
    model,
    baseUrl,
    temperature: 0.1,
    maxOutputTokens: 500,
    systemInstruction: [
      "You are a senior DevOps engineer guiding a junior through a live production incident.",
      "Evaluate the user's final answer honestly and directly.",
      "Prefer technical precision over politeness padding.",
      "Explain gaps clearly before positives.",
    ].join(" "),
    prompt: [
      "Evaluate the solution attempt.",
      "Output JSON only with keys: verdict, explanation, whatMissed, score.",
      "Verdict must be one of: correct, partially correct, incorrect.",
      "",
      "Output schema:",
      JSON.stringify(EVALUATION_SCHEMA, null, 2),
      "",
      "User's final answer:",
      userAnswer,
      "",
      "Correct solution from incident JSON:",
      incident.finalSolution,
      "",
      "Incident context:",
      JSON.stringify(
        {
          issue: incident.issue,
          symptoms: incident.symptoms,
          correctDebuggingSteps: incident.correctDebuggingSteps,
        },
        null,
        2,
      ),
    ].join("\n"),
  });
  return validateEvaluation(text);
}

function evaluateHeuristically(
  userAnswer: string,
  incident: DevOpsIncident,
): SolutionEvaluation {
  const userTokens = extractKeywords(userAnswer);
  const solutionTokens = extractKeywords(incident.finalSolution);
  const issueTokens = extractKeywords(incident.issue);

  const solutionOverlap = overlapRatio(userTokens, solutionTokens);
  const issueOverlap = overlapRatio(userTokens, issueTokens);

  let stepsMentioned = 0;
  for (const step of incident.correctDebuggingSteps) {
    const stepTokens = extractKeywords(step);
    if (overlapRatio(userTokens, stepTokens) >= 0.25) {
      stepsMentioned += 1;
    }
  }
  const stepCoverage = incident.correctDebuggingSteps.length
    ? stepsMentioned / incident.correctDebuggingSteps.length
    : 0;

  const weighted = solutionOverlap * 0.6 + issueOverlap * 0.2 + stepCoverage * 0.2;
  const score = clamp(Math.round(weighted * 10), 0, 10);

  let verdict: SolutionEvaluation["verdict"] = "incorrect";
  if (score >= 8) {
    verdict = "correct";
  } else if (score >= 5) {
    verdict = "partially correct";
  }

  const whatMissed = collectMissedItems(userTokens, incident);
  const explanation = buildHeuristicExplanation(verdict, score, whatMissed);

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

  const solutionTokens = extractKeywords(incident.finalSolution);
  if (overlapRatio(userTokens, solutionTokens) < 0.35) {
    missed.push("You did not cover the key remediation actions in enough detail.");
  }

  const issueTokens = extractKeywords(incident.issue);
  if (overlapRatio(userTokens, issueTokens) < 0.25) {
    missed.push("Your diagnosis does not align clearly with the observed failure pattern.");
  }

  for (const step of incident.correctDebuggingSteps.slice(0, 3)) {
    const stepTokens = extractKeywords(step);
    if (overlapRatio(userTokens, stepTokens) < 0.2) {
      missed.push(step);
    }
  }

  return missed.slice(0, 4);
}

function buildHeuristicExplanation(
  verdict: SolutionEvaluation["verdict"],
  score: number,
  whatMissed: string[],
): string {
  if (verdict === "correct") {
    return `Good call. Your plan is operationally sound and maps to the incident mechanics. (${score}/10)`;
  }
  if (verdict === "partially correct") {
    return `You are on the right track, but key gaps remain in validation depth and remediation detail. (${score}/10)`;
  }
  if (whatMissed.length) {
    return `This diagnosis is not aligned enough with the incident behavior. Rework your root-cause chain and mitigation plan. (${score}/10)`;
  }
  return `This answer is too generic to resolve the incident safely. Provide concrete root-cause and recovery steps. (${score}/10)`;
}

function validateEvaluation(text: string): SolutionEvaluation {
  const parsed = JSON.parse(extractJson(text)) as unknown;
  if (!isObject(parsed)) {
    throw new Error("Invalid evaluation payload from model.");
  }

  const verdictRaw = readString(parsed, "verdict").toLowerCase();
  const verdict = normalizeVerdict(verdictRaw);
  const explanation = readString(parsed, "explanation");
  const whatMissed = readStringArray(parsed, "whatMissed", 0, 8);
  const score = clamp(readScore(parsed, "score"), 0, 10);

  return {
    verdict,
    explanation,
    whatMissed,
    score,
  };
}

function normalizeVerdict(value: string): SolutionEvaluation["verdict"] {
  if (value === "correct") {
    return "correct";
  }
  if (value === "partially correct" || value === "partially_correct") {
    return "partially correct";
  }
  return "incorrect";
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
    logs: readStringArray(incident, "logs", 3, 8),
    symptoms: readStringArray(incident, "symptoms", 1, 8),
    correctDebuggingSteps: readStringArray(incident, "correctDebuggingSteps", 2, 12),
    finalSolution: readString(incident, "finalSolution"),
  };
}

function readUserAnswer(payload: unknown): string {
  if (!isObject(payload)) {
    throw new Error("Invalid payload.");
  }
  return readString(payload, "userAnswer");
}

function readString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid field: ${key}`);
  }
  return value.trim();
}

function readScore(obj: Record<string, unknown>, key: string): number {
  const value = obj[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.round(parsed);
    }
  }
  throw new Error(`Invalid score field: ${key}`);
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
