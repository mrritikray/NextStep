/**
 * Token-usage instrumentation for every Gemini-backed user action.
 *
 * Goals (token-optimisation work):
 *   - log, for every Gemini request:  operation name · input token estimate
 *     (real `usageMetadata` when the API returns it, characters/4 otherwise) ·
 *     response size · elapsed time;
 *   - log, for every USER ACTION, how many Gemini calls it actually made —
 *     this is how we prove "one resume analysis = one request".
 *
 * The per-action tally is kept in an AsyncLocalStorage so concurrent actions
 * (and the Promise.all clusters inside a single action) never mix counts.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { GeminiError } from "./gemini";

/** Rough token estimate used only when the API does not report real counts. */
export function estimateTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 4);
}

export type AiCallRecord = {
  operation: string;
  model: string;
  attempt: number;
  /** Characters of prompt text actually sent. */
  promptChars: number;
  /** Characters of the model response. */
  responseChars: number;
  /** Bytes of inline media (image/PDF) sent with the prompt. */
  mediaBytes: number;
  /** Real counts from Gemini `usageMetadata` when available. */
  promptTokens?: number;
  responseTokens?: number;
  totalTokens?: number;
  durationMs: number;
  callNumberInAction: number;
};

type ActionState = {
  name: string;
  startedAt: number;
  calls: AiCallRecord[];
  status: "ok" | "failed";
  errorType?: string;
};

const storage = new AsyncLocalStorage<ActionState>();

/* ------------------------------------------------------------------ */
/* Recent-action ring buffer (for the diagnostic endpoint)             */
/* ------------------------------------------------------------------ */

export type AiActionSummary = {
  action: string;
  geminiCalls: number;
  operations: Array<{ operation: string; calls: number }>;
  /** Prompt tokens across every call in the action (real when reported). */
  inputTokens: number;
  inputTokensEstimated: boolean;
  /** Response characters across every call in the action. */
  responseChars: number;
  durationMs: number;
  /** Whether the user action finished successfully or failed. */
  status: "ok" | "failed";
  /** Error identity when status is "failed" (e.g. "GeminiError:rate_limit"). */
  errorType?: string;
  at: string;
};

const MAX_RECENT = 25;
const recent: AiActionSummary[] = [];

export function recentAiActions(limit = 10): AiActionSummary[] {
  return recent.slice(-Math.max(1, Math.min(limit, MAX_RECENT))).reverse();
}

/* ------------------------------------------------------------------ */
/* Per-call recording                                                  */
/* ------------------------------------------------------------------ */

export function recordGeminiCall(record: AiCallRecord): void {
  const state = storage.getStore();
  if (state) state.calls.push(record);

  const inputTokens = record.promptTokens ?? estimateTokens(record.promptChars);
  const outputTokens = record.responseTokens ?? estimateTokens(record.responseChars);
  const tokenSource = record.promptTokens !== undefined ? "api" : "estimate";

  console.log(
    `[AI-Usage] gemini · operation=${record.operation} · model=${record.model} · attempt=${record.attempt} · ` +
      `input≈${inputTokens} tok (${record.promptChars} chars, ${tokenSource}${
        record.mediaBytes ? ` + ${record.mediaBytes}B media` : ""
      }) · output≈${outputTokens} tok (${record.responseChars} chars) · ${record.durationMs}ms · ` +
      `call#${record.callNumberInAction} of action${state ? `=${state.name}` : "=unscoped"}`,
  );
}

/** Logged when a Gemini request fails so the failure is visible in the tally. */
export function recordGeminiFailure(operation: string, model: string, message: string, promptChars: number): void {
  const state = storage.getStore();
  console.error(
    `[AI-Usage] gemini failed · operation=${operation} · model=${model} · input≈${estimateTokens(promptChars)} tok · ` +
      `action${state ? `=${state.name}` : "=unscoped"} · ${message}`,
  );
}

/* ------------------------------------------------------------------ */
/* Per-user-action scoping                                             */
/* ------------------------------------------------------------------ */

export function currentActionCallCount(): number {
  return storage.getStore()?.calls.length ?? 0;
}

function summarise(state: ActionState): AiActionSummary {
  const operations = new Map<string, number>();
  let inputTokens = 0;
  let responseChars = 0;
  let estimated = false;

  for (const call of state.calls) {
    operations.set(call.operation, (operations.get(call.operation) ?? 0) + 1);
    if (call.promptTokens !== undefined) inputTokens += call.promptTokens;
    else {
      inputTokens += estimateTokens(call.promptChars);
      estimated = true;
    }
    responseChars += call.responseChars;
  }

  return {
    action: state.name,
    geminiCalls: state.calls.length,
    operations: [...operations.entries()].map(([operation, calls]) => ({ operation, calls })),
    inputTokens,
    inputTokensEstimated: estimated,
    responseChars,
    durationMs: Date.now() - state.startedAt,
    status: state.status,
    ...(state.errorType ? { errorType: state.errorType } : {}),
    at: new Date().toISOString(),
  };
}

/**
 * Run one user action (a tRPC mutation) and log exactly how many Gemini calls
 * it made, plus the aggregated token/response sizes and its success/failure.
 */
export async function withAiAction<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const state: ActionState = { name, startedAt: Date.now(), calls: [], status: "failed" };
  return storage.run(state, async () => {
    try {
      const result = await fn();
      state.status = "ok";
      return result;
    } catch (error) {
      state.status = "failed";
      state.errorType =
        error instanceof GeminiError
          ? `GeminiError:${error.kind}`
          : error instanceof Error
            ? error.name
            : "unknown";
      throw error;
    } finally {
      const summary = summarise(state);
      recent.push(summary);
      if (recent.length > MAX_RECENT) recent.shift();
      console.log(
        `[AI-Usage] action=${summary.action} · geminiCalls=${summary.geminiCalls} · ` +
          `inputTokens≈${summary.inputTokens}${summary.inputTokensEstimated ? " (estimated)" : " (api)"} · ` +
          `responseChars=${summary.responseChars} · durationMs=${summary.durationMs} · ` +
          `status=${summary.status}${summary.errorType ? ` errorType=${summary.errorType}` : ""} · ` +
          `breakdown=${summary.operations.map(item => `${item.operation}×${item.calls}`).join(",") || "none"}`,
      );
    }
  });
}

/** The summary of the action currently running (for response payloads). */
export function currentActionSummary(): AiActionSummary | null {
  const state = storage.getStore();
  return state ? summarise(state) : null;
}
