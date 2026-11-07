import "server-only";

import { z } from "zod";

const apiBase = "https://generativelanguage.googleapis.com/v1beta/models";
const geminiTimeoutMs = 20_000;
const embedTimeoutMs = 15_000;
const defaultFallbackModel = "gemini-3.1-flash-lite";

type AiCallType = "embed" | "judge";

function getTimeoutMs(callType: AiCallType): number {
  const defaultValue = callType === "embed" ? embedTimeoutMs : geminiTimeoutMs;
  const configured = process.env[
    callType === "embed" ? "GEMINI_EMBED_TIMEOUT_MS" : "GEMINI_JSON_TIMEOUT_MS"
  ];
  if (configured === undefined || configured.trim() === "") {
    return defaultValue;
  }
  const timeoutMs = Number(configured);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `${callType === "embed" ? "GEMINI_EMBED_TIMEOUT_MS" : "GEMINI_JSON_TIMEOUT_MS"} must be a positive integer.`
    );
  }
  return timeoutMs;
}

function getApiKey(): string | null {
  const key = process.env.GEMINI_API_KEY;
  return key?.trim() || null;
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

class GeminiRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly quotaExhausted = false,
    readonly timedOut = false
  ) {
    super(message);
  }

  get canFallback(): boolean {
    return this.timedOut || this.status === 429 || (this.status ?? 0) >= 500;
  }
}

class GeminiInvalidResponseError extends Error {
  constructor(
    message: string,
    readonly responseText: string | null = null
  ) {
    super(message);
  }
}

function isTransientGeminiFailure(error: unknown): error is GeminiRequestError {
  return error instanceof GeminiRequestError && error.canFallback;
}

function isQuotaExhausted(body: unknown): boolean {
  if (
    typeof body !== "object" ||
    body === null ||
    !("error" in body) ||
    typeof body.error !== "object" ||
    body.error === null ||
    !("message" in body.error) ||
    typeof body.error.message !== "string"
  ) {
    return false;
  }
  return /quota|daily limit|resource exhausted/i.test(body.error.message);
}

async function request(
  url: string,
  init: RequestInit,
  callType: AiCallType,
): Promise<Response> {
  const timeoutMs = getTimeoutMs(callType);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new GeminiRequestError(
        `Gemini ${callType} request timed out after ${timeoutMs} ms.`,
        undefined,
        false,
        true
      );
    }
    throw new GeminiRequestError(`Gemini ${callType} network request failed.`);
  }
  if (!response.ok) {
    let payload: unknown;
    try {
      payload = await response.clone().json();
    } catch {
      payload = null;
    }
    const status = response.status;
    throw new GeminiRequestError(
      isQuotaExhausted(payload)
        ? "Gemini quota exhausted."
        : `Gemini ${callType} request failed with status ${status}.`,
      status,
      isQuotaExhausted(payload)
    );
  }
  return response;
}

export async function embed(
  texts: string[],
  taskType: "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT" = "RETRIEVAL_DOCUMENT"
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const key = getApiKey();
  if (!key) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }
  const model = getEmbedModel();
  const outputDimensionality = getEmbedDimensions();
  const response = await request(
    `${apiBase}/${encodeURIComponent(model)}:batchEmbedContents`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${model}`,
          content: { parts: [{ text }] },
          taskType,
          outputDimensionality,
        })),
      }),
    },
    "embed"
  );

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

async function generateRaw(
  model: string,
  system: string,
  user: string
): Promise<unknown> {
  if (!model) {
    throw new Error("GEMINI_CHAT_MODEL is not configured.");
  }

  const key = getApiKey();
  if (!key) {
    throw new Error("GEMINI_API_KEY is not configured on the server.");
  }
  const response = await request(
    `${apiBase}/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: 2048,
          thinkingConfig: { thinkingLevel: "low" },
        },
      }),
    },
    "judge"
  );

  const payload: unknown = await response.json();
  const responseSchema = z.object({
    candidates: z.array(
      z.object({
        content: z.object({
          parts: z.array(
            z.object({
              text: z.string().optional(),
              thought: z.boolean().optional(),
            })
          ),
        }),
      })
    ),
  });
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error("Gemini returned an invalid generation response.");
  }
  const text = parsed.data.candidates[0]?.content.parts
    .filter((part) => part.thought !== true)
    .map((part) => part.text ?? "")
    .join("");
  if (!text) {
    throw new GeminiInvalidResponseError("Gemini returned an empty response.");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new GeminiInvalidResponseError(
      "Gemini returned malformed JSON.",
      text
    );
  }
}

export type JsonProvider = "gemini" | "groq";
export type GenerateJsonResult<T> = {
  data: T;
  provider: JsonProvider;
  fallbackReason: string | null;
};

async function generateAndRepair<T>(
  model: string,
  system: string,
  user: string,
  zodSchema: z.ZodType<T>
): Promise<T> {
  let output: unknown;
  let invalidOutput: unknown;
  let repairAttempted = false;
  try {
    output = await generateRaw(model, system, user);
    const parsed = zodSchema.safeParse(output);
    if (parsed.success) {
      return parsed.data;
    }
    invalidOutput = output;
    let repaired: unknown;
    repairAttempted = true;
    try {
      repaired = await generateRaw(
        model,
        `${system}\nReturn only valid JSON matching the requested structure. Do not add markdown.`,
        JSON.stringify({
          originalRequest: user,
          invalidOutput,
          validationErrors: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        })
      );
    } catch (error) {
      if (error instanceof GeminiInvalidResponseError) {
        throw new GeminiInvalidResponseError(
          "Gemini returned invalid JSON after one repair attempt."
        );
      }
      throw error;
    }
    const repairedParsed = zodSchema.safeParse(repaired);
    if (repairedParsed.success) {
      return repairedParsed.data;
    }
  } catch (error) {
    if (
      !(error instanceof GeminiInvalidResponseError) ||
      error instanceof GeminiRequestError ||
      repairAttempted
    ) {
      throw error;
    }
    invalidOutput = error.responseText ?? error.message;
    repairAttempted = true;
    const repaired = await generateRaw(
      model,
      `${system}\nReturn only valid JSON matching the requested structure. Do not add markdown.`,
      JSON.stringify({
        originalRequest: user,
        invalidOutput,
      })
    );
    const repairedParsed = zodSchema.safeParse(repaired);
    if (repairedParsed.success) {
      return repairedParsed.data;
    }
  }
  throw new GeminiInvalidResponseError(
    "Gemini returned invalid JSON after one repair attempt."
  );
}

export async function generateJsonWithProvider<T>(
  system: string,
  user: string,
  zodSchema: z.ZodType<T>,
  options: { geminiOnly?: boolean } = {}
): Promise<GenerateJsonResult<T>> {
  const model = process.env.GEMINI_CHAT_MODEL;
  if (!model) {
    throw new Error("GEMINI_CHAT_MODEL is not configured.");
  }
  const fallbackModel =
    process.env.GEMINI_FALLBACK_MODEL?.trim() || defaultFallbackModel;
  const geminiKey = getApiKey();
  let fallbackReason: string | undefined;

  if (geminiKey) {
    try {
      const data = options.geminiOnly
        ? zodSchema.parse(await generateRaw(model, system, user))
        : await generateAndRepair(model, system, user, zodSchema);
      return { data, provider: "gemini", fallbackReason: null };
    } catch (error) {
      if (options.geminiOnly) {
        throw error;
      }
      if (isTransientGeminiFailure(error)) {
        fallbackReason = error.message;
        if (fallbackModel !== model) {
          try {
            const fallbackData = zodSchema.parse(
              await generateRaw(fallbackModel, system, user)
            );
            return {
              data: fallbackData,
              provider: "gemini",
              fallbackReason: `${fallbackModel}: ${fallbackReason}`,
            };
          } catch (fallbackError) {
            fallbackReason += ` Secondary Gemini model failed: ${
              fallbackError instanceof Error
                ? fallbackError.message
                : "unknown error"
            }.`;
          }
        } else {
          fallbackReason = `${fallbackReason} No distinct GEMINI_FALLBACK_MODEL is configured.`;
        }
      } else if (error instanceof GeminiInvalidResponseError || error instanceof z.ZodError) {
        fallbackReason = error.message;
      } else {
        throw error;
      }
    }
  } else {
    fallbackReason = "GEMINI_API_KEY is not configured.";
  }

  const groqKey = process.env.GROQ_API_KEY?.trim();
  if (!groqKey) {
    throw new Error(
      `${fallbackReason ?? "Gemini failed."} Groq fallback skipped because GROQ_API_KEY is not configured.`
    );
  }
  const groqModel = process.env.GROQ_MODEL?.trim();
  if (!groqModel) {
    throw new Error(
      `${fallbackReason ?? "Gemini failed."} Groq fallback skipped because GROQ_MODEL is not configured.`
    );
  }
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: groqModel,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`Groq request failed with status ${response.status}.`);
    }
    const groqPayload: unknown = await response.json();
    const groqSchema = z.object({
      choices: z.array(
        z.object({
          message: z.object({ content: z.string() }),
        })
      ),
    });
    const groqParsed = groqSchema.safeParse(groqPayload);
    if (!groqParsed.success) {
      throw new Error("Groq returned an invalid response.");
    }
    let output: unknown;
    try {
      output = JSON.parse(groqParsed.data.choices[0]?.message.content ?? "");
    } catch {
      throw new Error("Groq returned invalid JSON.");
    }
    const parsed = zodSchema.safeParse(output);
    if (!parsed.success) {
      throw new Error("Groq response failed schema validation.");
    }
    return {
      data: parsed.data,
      provider: "groq",
      fallbackReason: fallbackReason ?? "Gemini unavailable.",
    };
  } catch (error) {
    throw new Error(
      `${fallbackReason ?? "Gemini failed."} Groq fallback failed: ${
        error instanceof Error ? error.message : "unknown error"
      }`
    );
  }
}

export async function generateJson<T>(
  system: string,
  user: string,
  zodSchema: z.ZodType<T>
): Promise<T> {
  return (
    await generateJsonWithProvider(system, user, zodSchema)
  ).data;
}
