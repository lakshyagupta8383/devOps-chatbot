import type { ChatTurn, DevOpsIncident } from "@/lib/incident-types";

export const dynamic = "force-dynamic";

const SYSTEM_PROMPT =
  "You are a senior DevOps engineer guiding a user during a production incident.";

const DEFAULT_ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4.1-mini";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as unknown;
    const incident = readIncident(payload);
    const history = readHistory(payload);

    if (!history.length) {
      return Response.json(
        { error: "Conversation history is required." },
        { status: 400 },
      );
    }

    const reply = await createGuidanceReply(incident, history);
    return Response.json(
      { reply },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    console.error("Chat handler failed.", error);
    return Response.json(
      {
        reply:
          "I cannot reach the guidance model right now. Start by confirming blast radius, checking dependency health, and validating one hypothesis at a time.",
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
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return buildFallbackReply(incident, history);
  }

  const endpoint = process.env.OPENAI_API_URL ?? DEFAULT_ENDPOINT;
  const model =
    process.env.OPENAI_CHAT_MODEL ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_output_tokens: 280,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: SYSTEM_PROMPT }],
        },
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "Behavior rules:",
                "- Do not reveal the root cause directly.",
                "- Provide logs, hints, and guidance based on the incident context.",
                "- Encourage debugging thinking and hypothesis-driven investigation.",
                "- Ask at least one probing question.",
                "- Keep output concise and practical.",
              ].join("\n"),
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "Incident JSON:",
                JSON.stringify(incident, null, 2),
                "",
                "Conversation history (oldest to newest):",
                formatHistory(history),
                "",
                "Respond as the assistant for the next turn.",
              ].join("\n"),
            },
          ],
        },
      ],
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Chat model request failed (${response.status}): ${errorText}`);
  }

  const raw = (await response.json()) as unknown;
  const reply = extractOutputText(raw).trim();
  if (!reply) {
    return buildFallbackReply(incident, history);
  }

  if (revealsHiddenAnswer(reply, incident)) {
    return buildFallbackReply(incident, history);
  }

  return reply;
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

function formatHistory(history: ChatTurn[]): string {
  return history
    .map((turn, index) => `${index + 1}. ${turn.role.toUpperCase()}: ${turn.content}`)
    .join("\n");
}

function extractOutputText(payload: unknown): string {
  if (!isObject(payload)) {
    return "";
  }

  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  if (!Array.isArray(payload.output)) {
    return "";
  }

  for (const item of payload.output) {
    if (!isObject(item) || !Array.isArray(item.content)) {
      continue;
    }

    for (const part of item.content) {
      if (!isObject(part)) {
        continue;
      }
      if (typeof part.text === "string" && part.text.trim()) {
        return part.text;
      }
    }
  }

  return "";
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
