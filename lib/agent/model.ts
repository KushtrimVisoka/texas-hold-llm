import { anthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';

export type ProviderName = 'ollama' | 'anthropic';

const PROVIDER = (process.env.LLM_PROVIDER ?? 'ollama') as ProviderName;
const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1';

const DEFAULT_MODEL: Record<ProviderName, string> = {
  ollama: 'gemma4:latest',
  anthropic: 'claude-sonnet-5',
};

/**
 * Local models are an order of magnitude slower than a hosted API — an 8B model on a
 * laptop takes 15-25s for a decision with an image attached — so the two providers get
 * very different patience.
 */
const DEFAULT_TIMEOUT: Record<ProviderName, number> = {
  ollama: 120_000,
  anthropic: 20_000,
};

const ollama = createOpenAICompatible({ name: 'ollama', baseURL: OLLAMA_URL });

export const providerName = PROVIDER;
export const modelId = process.env.AGENT_MODEL ?? DEFAULT_MODEL[PROVIDER];
export const timeoutMs = Number(process.env.AGENT_TIMEOUT_MS ?? DEFAULT_TIMEOUT[PROVIDER]);

/**
 * One retry, not the SDK's default of two. Each attempt against a local model costs
 * ~20s, and the failure policy below already has a safe answer — waiting a minute to
 * produce the same fold helps nobody.
 */
export const maxRetries = Number(process.env.AGENT_MAX_RETRIES ?? 1);

export function agentModel(): LanguageModel {
  return PROVIDER === 'anthropic' ? anthropic(modelId) : ollama(modelId);
}

/** "gemma4:latest" -> "Gemma", "claude-sonnet-5" -> "Claude". Used to name the seat. */
export function displayName(id: string = modelId): string {
  const base = id.split(':')[0].split('/').pop() ?? id;
  const word = base.split(/[-_.]/)[0].replace(/\d+$/, '');
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** Maps a model family onto one of the seat avatars. */
export function avatarFor(id: string = modelId): string {
  const s = id.toLowerCase();
  for (const key of ['claude', 'gpt', 'gemma', 'gemini', 'llama', 'mistral', 'qwen', 'deepseek']) {
    if (s.includes(key)) return key;
  }
  return 'bot';
}
