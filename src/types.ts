export type Agent = "claude" | "codex" | "gemini";

export const AGENTS: Agent[] = ["claude", "codex", "gemini"];

export const AGENT_LABEL: Record<Agent, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
};

/** One normalized row per API request made by an agent. Token fields never overlap. */
export interface UsageRecord {
  agent: Agent;
  model: string;
  /** epoch ms */
  ts: number;
  /** absolute working directory when known, otherwise a best-effort label */
  project: string;
  sessionId: string;
  /** uncached input tokens */
  input: number;
  /** output tokens, including reasoning/thinking */
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  /** reasoning/thinking tokens (already included in output; informational) */
  reasoning: number;
  fast: boolean;
  subagent: boolean;
  /** server-side web searches billed per search (Claude: $10 / 1,000) */
  webSearches?: number;
  /** request pinned to US-only inference (Claude 4.6+: 1.1x on all tokens) */
  usOnly?: boolean;
}

/** Per-million-token prices in USD. */
export interface Rate {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  /** multiplier already applied to the fields above (e.g. 2 for fast mode) */
  multiplier: number;
}

export interface PricedRecord extends UsageRecord {
  cost: number;
  rate?: Rate;
}
