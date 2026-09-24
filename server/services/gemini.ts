/**
 * Centralised Gemini client.
 *
 * - Reads GEMINI_API_KEY / GEMINI_MODEL from the environment (server-only).
 * - Never logs or returns the API key.
 * - Retries transient failures (429 / 500 / 503 / network) with a bounded
 *   exponential backoff.
 * - Throws a typed error on real failures so callers can surface a real error
 *   instead of pretending a mocked result came from the model.
 *
 * Token-usage accounting: every request/response pair is reported to
 * `./aiUsage`, which logs the operation name, the input token estimate (real
 * `usageMetadata.promptTokenCount` when the API returns it), the response size
 * and the running call count for the user action that triggered it.
 */
import { ENV } from "../_core/env";
import { estimateTokens, recordGeminiCall, recordGeminiFailure } from "./aiUsage";

export type GeminiMode = "real" | "demo";

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

export class GeminiError extends Error {
  readonly status: number;
  readonly kind: "config" | "auth" | "rate_limit" | "server" | "network" | "parse";
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { status?: number; kind?: GeminiError["kind"]; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "GeminiError";
    this.status = options.status ?? 0;
    this.kind = options.kind ?? "server";
    this.retryable = options.retryable ?? false;
  }
}

export type GeminiRequest = {
  prompt: string;
  /** Optional base64 payload (image / pdf) sent as inlineData for multimodal calls. */
  media?: { mimeType: string; base64: string };
  /** Optional JSON schema to force a structured response. */
  schema?: Record<string, unknown>;
  temperature?: number;
  /** Override the configured model (used for text-only vs vision calls). */
  model?: string;
  operation?: string;
};

export function getApiKey(): string {
  return (process.env.GEMINI_API_KEY ?? ENV.geminiApiKey ?? "").trim();
}

/**
 * Default model. `gemini-2.5-flash` is a stable, widely-available multimodal
 * model on the v1beta REST API. Override with GEMINI_MODEL in .env.
 */
export function getModel(override?: string): string {
  return (
    override?.trim() ||
    (process.env.GEMINI_MODEL ?? ENV.geminiModel ?? "").trim() ||
    "gemini-2.5-flash"
  );
}

/**
 * API base URL. Blank in production (official endpoint). Tests / token-usage
 * verification can point GEMINI_BASE_URL at a counting stub — the request body
 * and every code path stay identical.
 */
export function getBaseUrl(): string {
  const raw = (process.env.GEMINI_BASE_URL ?? ENV.geminiBaseUrl ?? "").trim();
  return (raw || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
}

export function getMode(): GeminiMode {
  return getApiKey() ? "real" : "demo";
}

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 700;

/*
 * Free-tier REQUEST-COUNT guards (Google AI Studio flash defaults: 5 RPM /
 * 20 RPD). Every generateContent attempt — the first call AND any retry —
 * reserves a slot here, so:
 *   - the daily counter fails fast with a clear message once the RPD quota is
 *     spent (no doomed request is sent, which is itself a wasted request);
 *   - the sliding 60s window makes a burst wait for a free slot instead of
 *     triggering a 429.
 * Both limits are env-tunable and can be raised for paid keys / tests.
 */
const RPM_LIMIT = Number.parseInt(process.env.GEMINI_MAX_RPM ?? "", 10) || 5;
const RPD_LIMIT = Number.parseInt(process.env.GEMINI_MAX_RPD ?? "", 10) || 20;
/** Upper bound on how long one call may wait for a free per-minute slot. */
const MAX_SLOT_WAIT_MS = 65_000;
/** Upper bound on a server-provided Retry-After so one call cannot hang forever. */
const MAX_RETRY_AFTER_MS = 30_000;
/** A 429 gets at most ONE retry (2 attempts total) — never a retry storm. */
const MAX_429_ATTEMPTS = 2;
const RATE_LIMIT_DELAY_MS = 1_500;

let requestStartTimes: number[] = [];
let quotaDay = "";
let quotaDayCount = 0;

function dailyKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function resetQuotaDayIfNew(): void {
  const key = dailyKey();
  if (key !== quotaDay) {
    quotaDay = key;
    quotaDayCount = 0;
  }
}

/**
 * Reserve a request slot before an attempt, waiting briefly when the per-minute
 * window is full. Throws a typed rate_limit error (without network I/O) when the
 * daily quota is spent or the wait would be unbounded.
 */
async function reserveRequestSlot(): Promise<void> {
  const now = Date.now();
  resetQuotaDayIfNew();

  if (quotaDayCount >= RPD_LIMIT) {
    throw new GeminiError(
      "The daily Gemini request quota for this API key is used up. The limit resets tomorrow (UTC), or raise GEMINI_MAX_RPD with a paid key.",
      { status: 429, kind: "rate_limit", retryable: false },
    );
  }

  requestStartTimes = requestStartTimes.filter(startedAt => startedAt > now - 60_000);
  if (requestStartTimes.length >= RPM_LIMIT) {
    const waitMs = requestStartTimes[0] + 60_000 - now;
    if (waitMs > MAX_SLOT_WAIT_MS) {
      throw new GeminiError("The per-minute Gemini request limit is fully booked. Please try again shortly.", {
        status: 429,
        kind: "rate_limit",
        retryable: false,
      });
    }
    await sleep(waitMs + 50);
  }

  requestStartTimes.push(Date.now());
  quotaDayCount += 1;
}

/** Milliseconds to wait for a retry, from a 429 response's Retry-After headers. */
function retryAfterMs(headers: Headers): number | null {
  const headerMs = headers.get("retry-after-ms");
  if (headerMs) {
    const ms = Number.parseFloat(headerMs);
    if (Number.isFinite(ms) && ms >= 0) return Math.min(ms, MAX_RETRY_AFTER_MS);
  }
  const headerSeconds = headers.get("retry-after");
  if (headerSeconds) {
    const seconds = Number.parseFloat(headerSeconds);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
    const asDate = Date.parse(headerSeconds);
    if (!Number.isNaN(asDate)) return Math.min(Math.max(0, asDate - Date.now()), MAX_RETRY_AFTER_MS);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function classify(status: number): GeminiError["kind"] {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  return "server";
}

function isRetryable(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

/** Strip anything that could leak a secret before logging. */
function safeMessage(message: string, apiKey: string): string {
  let out = message;
  if (apiKey) out = out.split(apiKey).join("***");
  out = out.replace(/key=[^\s&"']+/gi, "key=***");
  out = out.replace(/AIza[0-9A-Za-z_\-]{10,}/g, "***");
  return out.length > 400 ? `${out.slice(0, 400)}…` : out;
}

/** Build the exact request body sent to Gemini (also used by the usage logger). */
export function buildGeminiBody(request: GeminiRequest): Record<string, unknown> {
  const parts: GeminiPart[] = [];
  if (request.media?.base64) {
    parts.push({
      inlineData: { mimeType: request.media.mimeType || "application/octet-stream", data: request.media.base64 },
    });
  }
  parts.push({ text: request.prompt });

  return {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: request.temperature ?? 0.2,
      // Every NextStep operation returns strict JSON; the schema (when supplied)
      // constrains the shape, which keeps responses compact and parseable.
      responseMimeType: "application/json",
      ...(request.schema ? { responseSchema: request.schema } : {}),
    },
  };
}

type GeminiResponsePayload = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

/**
 * Call Gemini generateContent. Returns the raw text of the first candidate.
 */
export async function generateContent(request: GeminiRequest): Promise<string> {
  const apiKey = getApiKey();
  const operation = request.operation ?? "generateContent";
  const promptChars = request.prompt.length;
  const mediaBytes = request.media?.base64 ? Math.ceil((request.media.base64.length * 3) / 4) : 0;

  if (!apiKey) {
    throw new GeminiError("Gemini API key is not configured.", { kind: "config" });
  }

  const model = getModel(request.model);
  const url = `${getBaseUrl()}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body = buildGeminiBody(request);

  let lastError: GeminiError | null = null;
  let callNumber = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    try {
      // Quota guard: may wait for a free per-minute slot or fail fast with a
      // typed rate_limit error before any network request is made.
      await reserveRequestSlot();

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const raw = await response.text().catch(() => "");
        const kind = classify(response.status);
        const retryable = isRetryable(response.status);
        const detail = safeMessage(raw, apiKey);

        console.error(
          `[Gemini] ${operation} failed · model=${model} · status=${response.status} · ${detail}`,
        );
        recordGeminiFailure(operation, model, `status=${response.status}`, promptChars);

        if (response.status === 404) {
          throw new GeminiError(
            `The configured model "${model}" is not available for this API key.`,
            { status: 404, kind: "config", retryable: false },
          );
        }

        // 429: at most ONE retry, honouring Retry-After so the quota window is
        // respected instead of hammering the API. 5xx: bounded backoff.
        // The error is marked non-retryable once this attempt limit is reached,
        // so the outer catch below cannot sneak in an extra attempt.
        const attemptLimit = kind === "rate_limit" ? MAX_429_ATTEMPTS : MAX_ATTEMPTS;
        const willRetry = retryable && attempt < attemptLimit;

        lastError = new GeminiError(
          kind === "auth"
            ? "Gemini rejected the API key. Check GEMINI_API_KEY."
            : kind === "rate_limit"
              ? "Gemini rate limit reached."
              : `Gemini returned HTTP ${response.status}.`,
          { status: response.status, kind, retryable: willRetry },
        );

        if (willRetry) {
          const backoff =
            kind === "rate_limit"
              ? (retryAfterMs(response.headers) ?? RATE_LIMIT_DELAY_MS * 2 ** (attempt - 1))
              : BASE_DELAY_MS * 2 ** (attempt - 1);
          await sleep(backoff);
          continue;
        }
        throw lastError;
      }

      const data = (await response.json()) as GeminiResponsePayload;

      if (data.promptFeedback?.blockReason) {
        throw new GeminiError("Gemini blocked the request content.", {
          kind: "parse",
          retryable: false,
        });
      }

      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .map(part => part.text ?? "")
        .join("")
        .trim();

      if (!text) {
        throw new GeminiError("Gemini returned an empty response.", {
          kind: "parse",
          retryable: false,
        });
      }

      callNumber += 1;
      recordGeminiCall({
        operation,
        model,
        attempt,
        promptChars,
        responseChars: text.length,
        mediaBytes,
        promptTokens: data.usageMetadata?.promptTokenCount,
        responseTokens: data.usageMetadata?.candidatesTokenCount,
        totalTokens: data.usageMetadata?.totalTokenCount,
        durationMs: Date.now() - startedAt,
        callNumberInAction: callNumber,
        // Kept for callers that want the estimate without the log line.
      });

      return text;
    } catch (error) {
      if (error instanceof GeminiError) {
        if (error.retryable && attempt < MAX_ATTEMPTS) {
          await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
          continue;
        }
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[Gemini] ${operation} network error · model=${model} · ${safeMessage(message, apiKey)}`,
      );
      recordGeminiFailure(operation, model, "network", promptChars);
      lastError = new GeminiError("Could not reach the Gemini API.", {
        kind: "network",
        retryable: true,
      });
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new GeminiError("Gemini request failed.");
}

/**
 * Call Gemini and parse the response as JSON. Falls back to extracting the
 * first JSON object/array from the text when the model wraps it in prose.
 */
export async function generateJson<T>(request: GeminiRequest): Promise<T> {
  const text = await generateContent(request);
  return parseModelJson<T>(text, request.operation ?? "generateContent");
}

export function parseModelJson<T>(text: string, operation: string): T {
  const trimmed = text.trim();
  const candidates = [trimmed];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const start = trimmed.search(/[[{]/);
  if (start >= 0) {
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (end > start) candidates.push(trimmed.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      /* try next */
    }
  }

  console.error(`[Gemini] ${operation} returned unparseable JSON.`);
  throw new GeminiError("Gemini returned a response that could not be parsed.", {
    kind: "parse",
  });
}

/** Estimated prompt tokens for a request (chars/4) — used by the log summary. */
export function estimateRequestTokens(request: GeminiRequest): number {
  return estimateTokens(request.prompt.length);
}

export function geminiFailureMessage(error: unknown): string {
  if (error instanceof GeminiError) {
    if (error.kind === "config") return error.message;
    if (error.kind === "auth") return "Gemini rejected the configured API key. Check GEMINI_API_KEY.";
    if (error.kind === "rate_limit") return "AI usage limit reached temporarily. Please try again shortly.";
    if (error.kind === "network") return "Could not reach the Gemini API. Check your connection and try again.";
  }
  return "Unable to complete the analysis right now. Please try again.";
}
