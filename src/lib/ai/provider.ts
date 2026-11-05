import "server-only";

import { z } from "zod";

const apiBase = "https://generativelanguage.googleapis.com/v1beta/models";
const requestTimeoutMs = 8_000;
const maxAttempts = 3;

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }
  return key;
}

function getEmbedModel(): string {
  const model = process.env.GEMINI_EMBED_MODEL;
  if (!model) {
    throw new Error("GEMINI_EMBED_MODEL is not configured.");
  }
  return model;
}

function getEmbedDimensions(): number {
  const dimension = Number(process.env.EMBED_DIM);
  if (!Number.isInteger(dimension) || dimension !== 1536) {
    throw new Error("EMBED_DIM must be set to 1536 to match the database vector.");
  }
  return dimension;
}

async function requestWithRetry(
  url: string,
  init: RequestInit
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(requestTimeoutMs),
      });

      if (
        response.ok ||
        (response.status < 500 && response.status !== 429) ||
        attempt === maxAttempts - 1
      ) {
        return response;
      }

      lastError = new Error(`Gemini request failed with status ${response.status}.`);
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error("Gemini request failed.");
      if (attempt === maxAttempts - 1) {
        break;
      }
    }

    await new Promise((resolve) =>
      setTimeout(resolve, 250 * 2 ** attempt)
    );
  }

  throw new Error(
    `Gemini request failed after ${maxAttempts} attempts: ${
      lastError?.name === "TimeoutError"
        ? "request timed out after 8 seconds"
        : lastError?.message ?? "unknown error"
    }`
  );
}

export async function embed(
  texts: string[],
  taskType: "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT" = "RETRIEVAL_DOCUMENT"
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const key = getApiKey();
  const model = getEmbedModel();
  const outputDimensionality = getEmbedDimensions();
  const response = await requestWithRetry(
    `${apiBase}/${encodeURIComponent(model)}:batchEmbedContents?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${model}`,
          content: { parts: [{ text }] },
          taskType,
          outputDimensionality,
        })),
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini embedding request failed with status ${response.status}.`);
  }

  const payload: unknown = await response.json();
  const embeddingSchema = z.object({
    embeddings: z.array(
      z.object({ values: z.array(z.number().finite()) })
    ),
  });
  const parsed = embeddingSchema.safeParse(payload);
  if (!parsed.success || parsed.data.embeddings.length !== texts.length) {
    throw new Error("Gemini returned an invalid embedding response.");
  }

  return parsed.data.embeddings.map(({ values }) => {
    if (values.length !== 1536) {
      throw new Error(
        `Gemini returned ${values.length} embedding dimensions; expected 1536.`
      );
    }
    const magnitude = Math.sqrt(
      values.reduce((sum, value) => sum + value * value, 0)
    );
    if (!magnitude) {
      throw new Error("Gemini returned a zero-length embedding.");
    }
    return values.map((value) => value / magnitude);
  });
}

async function generateRaw(system: string, user: string): Promise<unknown> {
  const model = process.env.GEMINI_CHAT_MODEL;
  if (!model) {
    throw new Error("GEMINI_CHAT_MODEL is not configured.");
  }

  const key = getApiKey();
  const response = await requestWithRetry(
    `${apiBase}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini generation request failed with status ${response.status}.`);
  }
  const payload: unknown = await response.json();
  const responseSchema = z.object({
    candidates: z.array(
      z.object({
        content: z.object({
          parts: z.array(z.object({ text: z.string() })),
        }),
      })
    ),
  });
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Gemini returned an invalid generation response.");
  }
  const text = parsed.data.candidates[0]?.content.parts
    .map((part) => part.text)
    .join("");
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Gemini returned malformed JSON.");
  }
}

export async function generateJson<T>(
  system: string,
  user: string,
  zodSchema: z.ZodType<T>
): Promise<T> {
  let output: unknown;
  try {
    output = await generateRaw(system, user);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "Gemini returned malformed JSON.") {
      throw error;
    }
    output = null;
  }

  const parsed = zodSchema.safeParse(output);
  if (parsed.success) {
    return parsed.data;
  }

  const repair = await generateRaw(
    `${system}\nReturn only valid JSON matching the requested structure. Do not add markdown.`,
    JSON.stringify({
      originalRequest: user,
      invalidOutput: output,
      validationErrors: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    })
  );
  const repaired = zodSchema.safeParse(repair);
  if (!repaired.success) {
    throw new Error("Gemini response failed schema validation after one repair attempt.");
  }
  return repaired.data;
}
