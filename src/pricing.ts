import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PricedRecord, Rate, UsageRecord } from "./types.js";

/** USD per million tokens. `read` is the cache-read price; cache writes are 1.25x (5m) / 2x (1h) input. */
interface ClaudePrice {
  input: number;
  output: number;
  read: number;
  /** fast-mode multiplier, where Anthropic publishes one */
  fast?: number;
  /** Claude 4.6+: US-only inference (`inference_geo: "us"`) costs 1.1x on every token category */
  geo?: boolean;
  /** pricier tier when the prompt (input + cache) exceeds `above` tokens */
  tier?: { above: number; input: number; output: number; read: number };
}

/**
 * Anthropic first-party list prices, checked against
 * https://platform.claude.com/docs/en/about-claude/pricing on 2026-10-29.
 * Matched by longest prefix, so "claude-opus-5-5" wins over "claude-opus-5".
 */
export const CLAUDE_PRICES: Record<string, ClaudePrice> = {
  "claude-fable-5-1": { input: 10, output: 50, read: 0.25, geo: true },
  "claude-mythos-5-1": { input: 10, output: 50, read: 0.25, geo: true },
  "claude-fable-5": { input: 10, output: 50, read: 1, geo: true },
  "claude-mythos-5": { input: 10, output: 50, read: 1, geo: true },
  "claude-opus-5-5": { input: 4, output: 20, read: 0.2, fast: 2, geo: true },
  "claude-opus-5": { input: 5, output: 25, read: 0.5, fast: 2, geo: true },
  "claude-opus-4-8": { input: 5, output: 25, read: 0.5, fast: 2, geo: true },
  "claude-opus-4-7": { input: 5, output: 25, read: 0.5, geo: true },
  "claude-opus-4-6": { input: 5, output: 25, read: 0.5, geo: true },
  "claude-opus-4-5": { input: 5, output: 25, read: 0.5 },
  "claude-opus-4-1": { input: 15, output: 75, read: 1.5 },
  "claude-opus-4": { input: 15, output: 75, read: 1.5 },
  "claude-3-opus": { input: 15, output: 75, read: 1.5 },
  "claude-sonnet-5-5": { input: 2, output: 10, read: 0.1, geo: true },
  "claude-sonnet-5": { input: 2, output: 10, read: 0.2, geo: true },
  "claude-sonnet-4-6": { input: 3, output: 15, read: 0.3, geo: true },
  "claude-sonnet-4-5": { input: 3, output: 15, read: 0.3 },
  "claude-sonnet-4": { input: 3, output: 15, read: 0.3 },
  "claude-3-7-sonnet": { input: 3, output: 15, read: 0.3 },
  "claude-3-5-sonnet": { input: 3, output: 15, read: 0.3 },
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    read: 0.01,
    geo: true,
    tier: { above: 100_000, input: 0.5, output: 2.5, read: 0.05 },
  },
  "claude-haiku-4-5": { input: 1, output: 5, read: 0.1 },
  "claude-3-5-haiku": { input: 0.8, output: 4, read: 0.08 },
  "claude-3-haiku": { input: 0.25, output: 1.25, read: 0.03 },
};

const CLAUDE_KEYS = Object.keys(CLAUDE_PRICES).sort((a, b) => b.length - a.length);

/** "us.anthropic.claude-sonnet-4-5-20250929-v1:0" / "claude-opus-4-5@20251101" / "claude-opus-5-5[1m]" -> base id */
export function normalizeModel(model: string): string {
  return model
    .toLowerCase()
    .replace(/^.*anthropic[./]/, "")
    .replace(/\[.*?\]$/, "")
    .replace(/@.*$/, "")
    .replace(/-v\d+:\d+$/, "")
    .replace(/-\d{8}$/, "");
}

function claudeRate(model: string, promptTokens: number, fast: boolean, usOnly = false): Rate | undefined {
  const m = normalizeModel(model);
  const key = CLAUDE_KEYS.find((k) => m === k || m.startsWith(k + "-"));
  if (!key) return undefined;
  const p = CLAUDE_PRICES[key];
  const base = p.tier && promptTokens > p.tier.above ? p.tier : p;
  const mult = fast && p.fast ? p.fast : 1;
  const all = mult * (usOnly && p.geo ? 1.1 : 1);
  return {
    input: base.input * all,
    output: base.output * all,
    cacheRead: base.read * all,
    cacheWrite5m: base.input * 1.25 * all,
    cacheWrite1h: base.input * 2 * all,
    multiplier: mult,
  };
}

/** Opus / Fable / Mythos: the top Claude tier, where a lighter model is often enough. */
export function isPremiumClaude(model: string): boolean {
  return /^claude-(opus|fable|mythos|3-opus)/.test(normalizeModel(model));
}

/** What the same request would cost on Claude Sonnet 5.5 (standard speed, same inference geography). */
export function sonnetEquivalent(r: UsageRecord): number {
  return costWith(r, claudeRate("claude-sonnet-5-5", promptTokens(r), false, r.usOnly)!);
}

/** Subset of LiteLLM's model_prices_and_context_window.json (USD per token). */
type LiteLLMTable = Record<string, Record<string, unknown>>;

const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

function cacheFile(): string {
  const base =
    process.env.XDG_CACHE_HOME ||
    (process.platform === "win32" && process.env.LOCALAPPDATA
      ? process.env.LOCALAPPDATA
      : path.join(os.homedir(), ".cache"));
  return path.join(base, "agentreceipt", "litellm-prices.json");
}

/**
 * Prices for non-Claude models come from LiteLLM's public table, cached for 24h.
 * Only this price list is downloaded; no usage data ever leaves the machine.
 */
export async function loadLiteLLM(offline: boolean): Promise<LiteLLMTable> {
  const file = cacheFile();
  let cached: LiteLLMTable | undefined;
  try {
    const stat = await fs.stat(file);
    cached = JSON.parse(await fs.readFile(file, "utf8"));
    if (offline || Date.now() - stat.mtimeMs < 24 * 3600 * 1000) return cached ?? {};
  } catch {
    if (offline) return {};
  }
  try {
    const res = await fetch(LITELLM_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(String(res.status));
    const text = await res.text();
    const table = JSON.parse(text) as LiteLLMTable;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
    return table;
  } catch {
    return cached ?? {};
  }
}

function perM(v: unknown): number | undefined {
  return typeof v === "number" ? v * 1e6 : undefined;
}

function liteRate(table: LiteLLMTable, model: string, promptTokens: number): Rate | undefined {
  const m = model.toLowerCase();
  const stripped = m.replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/-\d{8}$/, "");
  const candidates = [m, `openai/${m}`, `gemini/${m}`, `vertex_ai/${m}`, stripped, `openai/${stripped}`, `gemini/${stripped}`];
  const e = candidates.map((c) => table[c]).find((x) => x && typeof x.input_cost_per_token === "number");
  if (!e) return undefined;
  const long = promptTokens > 200_000;
  const input = (long && perM(e.input_cost_per_token_above_200k_tokens)) || perM(e.input_cost_per_token)!;
  const output =
    (long && perM(e.output_cost_per_token_above_200k_tokens)) || perM(e.output_cost_per_token) || 0;
  const read =
    (long && perM(e.cache_read_input_token_cost_above_200k_tokens)) ||
    perM(e.cache_read_input_token_cost) ||
    input;
  const write = perM(e.cache_creation_input_token_cost) ?? input * 1.25;
  return {
    input,
    output,
    cacheRead: read,
    cacheWrite5m: write,
    cacheWrite1h: perM(e.cache_creation_input_token_cost_above_1hr) ?? input * 2,
    multiplier: 1,
  };
}

export function promptTokens(r: UsageRecord): number {
  return r.input + r.cacheRead + r.cacheWrite5m + r.cacheWrite1h;
}

/** Claude web search: $10 per 1,000 searches, on top of tokens. */
export const WEB_SEARCH_USD = 0.01;

export function costWith(r: UsageRecord, rate: Rate): number {
  return (
    (r.webSearches ?? 0) * WEB_SEARCH_USD +
    (r.input * rate.input +
      r.output * rate.output +
      r.cacheRead * rate.cacheRead +
      r.cacheWrite5m * rate.cacheWrite5m +
      r.cacheWrite1h * rate.cacheWrite1h) /
    1e6
  );
}

export class PriceBook {
  constructor(private litellm: LiteLLMTable = {}) {}

  rateFor(r: UsageRecord): Rate | undefined {
    const pt = promptTokens(r);
    return claudeRate(r.model, pt, r.fast, r.usOnly) ?? liteRate(this.litellm, r.model, pt);
  }

  price(records: UsageRecord[]): PricedRecord[] {
    return records.map((r) => {
      const rate = this.rateFor(r);
      return { ...r, rate, cost: rate ? costWith(r, rate) : 0 };
    });
  }
}

/** True if any record needs the LiteLLM table (i.e. isn't a known Claude model). */
export function needsLiteLLM(records: UsageRecord[]): boolean {
  return records.some((r) => !claudeRate(r.model, 0, false));
}
