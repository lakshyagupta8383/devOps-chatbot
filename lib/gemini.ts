import "server-only";

type GeminiGenerateOptions = {
  prompt: string;
  systemInstruction?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
  maxOutputTokens?: number;
};

const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";

export async function generateGeminiText(
  options: GeminiGenerateOptions,
): Promise<string> {
  const apiKey =
    options.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY (or GOOGLE_API_KEY).");
  }

  const model = options.model ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
  const baseUrl =
    (options.baseUrl ?? process.env.GEMINI_API_URL ?? DEFAULT_GEMINI_BASE_URL).replace(
      /\/$/,
      "",
    );

  const response = await fetch(
    `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: options.prompt }],
          },
        ],
        ...(options.systemInstruction
          ? {
              systemInstruction: {
                parts: [{ text: options.systemInstruction }],
              },
            }
          : {}),
        generationConfig: {
          ...(typeof options.temperature === "number"
            ? { temperature: options.temperature }
            : {}),
          ...(typeof options.maxOutputTokens === "number"
            ? { maxOutputTokens: options.maxOutputTokens }
            : {}),
        },
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Gemini request failed (${response.status}): ${errorText.slice(0, 500)}`,
    );
  }

  const payload = (await response.json()) as unknown;
  const text = extractGeminiText(payload).trim();
  if (!text) {
    throw new Error("Gemini response did not contain text output.");
  }

  return text;
}

function extractGeminiText(payload: unknown): string {
  if (!isObject(payload) || !Array.isArray(payload.candidates)) {
    return "";
  }

  for (const candidate of payload.candidates) {
    if (!isObject(candidate) || !isObject(candidate.content)) {
      continue;
    }

    const parts = candidate.content.parts;
    if (!Array.isArray(parts)) {
      continue;
    }

    const texts = parts
      .map((part) => (isObject(part) && typeof part.text === "string" ? part.text : ""))
      .filter(Boolean);
    if (texts.length) {
      return texts.join("\n").trim();
    }
  }

  return "";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
