import "server-only";
import { GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from "@google/genai";
import { config, geminiConfigured } from "../config";

let client: GoogleGenAI | null = null;

export function gemini(): GoogleGenAI | null {
  if (!geminiConfigured()) return null;
  client ??= new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return client;
}

export function geminiModel(): string {
  return config.gemini.model;
}

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Overload, rate-limit and transient server errors are worth retrying on another model. */
function retryable(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e);
  return /\b(429|500|502|503|504)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand|timed out/i.test(msg);
}

/**
 * Generate with the configured model, falling back through
 * GEMINI_FALLBACK_MODELS when a model is overloaded. Returns the model used so
 * answers and narratives record their true provenance.
 */
export async function generateWithFallback(
  params: Omit<GenerateContentParameters, "model">,
  timeoutMs: number,
  label: string,
  /** Absolute epoch-ms deadline across all attempts and models. */
  deadline = Date.now() + timeoutMs * 3,
): Promise<{ res: GenerateContentResponse; model: string }> {
  const ai = gemini();
  if (!ai) throw new Error("GEMINI_API_KEY is not configured");
  const models = [config.gemini.model, ...config.gemini.fallbackModels.filter((m) => m !== config.gemini.model)];
  let last: unknown;
  for (const model of models) {
    // Two attempts per model with a short backoff: Gemini overload (503) is usually brief.
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 2_000) throw last instanceof Error ? last : new Error(`${label} exceeded its time budget`);
      try {
        const res = await withTimeout(ai.models.generateContent({ ...params, model }), Math.min(timeoutMs, remaining), label);
        return { res, model };
      } catch (e) {
        last = e;
        if (!retryable(e)) throw e;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
