import "server-only";

import { generateGeminiText } from "./gemini";
import type { DevOpsIncident } from "./incident-types";

type GenerateIncidentOptions = {
  apiKey?: string;
  endpoint?: string;
  model?: string;
};

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    serviceName: { type: "string" },
    region: { type: "string" },
    errorRate: { type: "string" },
    issue: { type: "string" },
    logs: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: { type: "string" },
    },
    symptoms: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      items: { type: "string" },
    },
    correctDebuggingSteps: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: { type: "string" },
    },
    finalSolution: { type: "string" },
  },
  required: [
    "serviceName",
    "region",
    "errorRate",
    "issue",
    "logs",
    "symptoms",
    "correctDebuggingSteps",
    "finalSolution",
  ],
} as const;

export async function generateRandomIncident(
  options: GenerateIncidentOptions = {},
): Promise<DevOpsIncident> {
  const model =
    options.model ??
    process.env.GEMINI_INCIDENT_MODEL ??
    process.env.GEMINI_MODEL;
  const baseUrl = options.endpoint ?? process.env.GEMINI_API_URL;
  const randomToken = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const outputText = await generateGeminiText({
    model,
    baseUrl,
    apiKey: options.apiKey,
    temperature: 0.9,
    maxOutputTokens: 700,
    systemInstruction: [
      "Generate realistic but concise DevOps production incidents.",
      "Return only valid JSON. No markdown.",
      "Keep logs compact and operationally plausible.",
    ].join(" "),
    prompt: [
      "Generate one random incident with these fields:",
      "serviceName, region, errorRate, issue, logs, symptoms, correctDebuggingSteps, finalSolution.",
      "Constraints:",
      "- logs: 3 to 5 lines",
      "- symptoms: 1 to 5",
      "- correctDebuggingSteps: 3 to 6",
      "- Keep outputs concise.",
      `Randomness token: ${randomToken}`,
      "",
      "Return JSON exactly in this shape:",
      JSON.stringify(RESPONSE_SCHEMA, null, 2),
    ].join("\n"),
  });
  const parsedJson = JSON.parse(extractJson(outputText)) as unknown;
  return validateIncident(parsedJson);
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    const withoutFence = trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    if (withoutFence) {
      return withoutFence;
    }
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function validateIncident(raw: unknown): DevOpsIncident {
  if (!isObject(raw)) {
    throw new Error("Incident payload is not a JSON object.");
  }

  const serviceName = readString(raw, ["serviceName", "service_name", "service name"]);
  const region = readString(raw, ["region"]);
  const errorRate = readString(raw, ["errorRate", "error_rate", "error rate"]);
  const issue = readString(raw, ["issue", "rootCause", "root_cause"]);
  const logs = readStringArray(raw, ["logs"], 3, 5);
  const symptoms = readStringArray(raw, ["symptoms"], 1, 5);
  const correctDebuggingSteps = readStringArray(
    raw,
    ["correctDebuggingSteps", "debuggingSteps", "debugging_steps"],
    3,
    8,
  );
  const finalSolution = readString(raw, [
    "finalSolution",
    "solution",
    "final_solution",
  ]);

  return {
    serviceName,
    region,
    errorRate,
    issue,
    logs,
    symptoms,
    correctDebuggingSteps,
    finalSolution,
  };
}

function readString(obj: Record<string, unknown>, keys: string[]): string {
  const value = readValue(obj, keys);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing or invalid string field: ${keys[0]}`);
  }
  return value.trim();
}

function readStringArray(
  obj: Record<string, unknown>,
  keys: string[],
  minLength: number,
  maxLength: number,
): string[] {
  const value = readValue(obj, keys);
  if (!Array.isArray(value)) {
    throw new Error(`Missing or invalid array field: ${keys[0]}`);
  }

  const items = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);

  if (items.length < minLength || items.length > maxLength) {
    throw new Error(
      `Field ${keys[0]} must contain between ${minLength} and ${maxLength} items.`,
    );
  }

  return items;
}

function readValue(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in obj) {
      return obj[key];
    }
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
