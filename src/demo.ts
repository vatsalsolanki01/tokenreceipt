import type { Agent, UsageRecord } from "./types.js";

/** Deterministic PRNG so the demo looks the same on every machine. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROJECTS = [
  "/home/dev/code/checkout-api",
  "/home/dev/code/web-app",
  "/home/dev/code/infra",
  "/home/dev/code/ml-pipeline",
  "/home/dev/code/docs-site",
];

const MODELS: Record<Agent, string[]> = {
  claude: ["claude-opus-5-5", "claude-opus-5-5", "claude-opus-5-5", "claude-sonnet-5-5"],
  codex: ["gpt-5-codex"],
  gemini: ["gemini-2.5-pro"],
};

/** LiteLLM-shaped prices for the demo's non-Claude models, so --demo works offline. */
export const DEMO_PRICES = {
  "gpt-5-codex": {
    input_cost_per_token: 1.25e-6,
    output_cost_per_token: 10e-6,
    cache_read_input_token_cost: 0.125e-6,
  },
  "gemini-2.5-pro": {
    input_cost_per_token: 1.25e-6,
    output_cost_per_token: 10e-6,
    cache_read_input_token_cost: 0.31e-6,
  },
};

export function demoRecords(days = 30, seed = 42): UsageRecord[] {
  const rnd = mulberry32(seed);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const out: UsageRecord[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let sid = 0;

  for (let d = days - 1; d >= 0; d--) {
    const day = new Date(today);
    day.setDate(today.getDate() - d);
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    const sessionsToday = weekend ? Math.floor(rnd() * 2) : 2 + Math.floor(rnd() * 4);

    for (let s = 0; s < sessionsToday; s++) {
      const roll = rnd();
      const agent: Agent = roll < 0.68 ? "claude" : roll < 0.9 ? "codex" : "gemini";
      const model = pick(MODELS[agent]);
      const project = pick(PROJECTS);
      const sessionId = `demo-${++sid}`;
      let t = day.getTime() + Math.round((9 + rnd() * 9) * 3600_000);
      let context = 18_000 + Math.floor(rnd() * 12_000);
      const requests = 15 + Math.floor(rnd() * (agent === "claude" ? 140 : 60));

      for (let i = 0; i < requests; i++) {
        // occasional long break -> cache expires and gets rebuilt
        const idle = rnd() < 0.015;
        const gap = idle ? 65 * 60_000 + rnd() * 60 * 60_000 : 8_000 + rnd() * 90_000;
        t += Math.round(gap);
        const growth = 1_500 + Math.floor(rnd() * 7_000);
        const subagent = agent === "claude" && rnd() < 0.12;
        // ~40% of agent turns are short tool calls; the rest write real code or explanations
        const output =
          rnd() < 0.4 ? 40 + Math.floor(rnd() * 240) : 300 + Math.floor(rnd() * (rnd() < 0.1 ? 6_000 : 1_400));
        const rec: UsageRecord = {
          agent,
          model: subagent ? "claude-haiku-5-5" : model,
          ts: t,
          project,
          sessionId,
          input: 2 + Math.floor(rnd() * 400),
          output,
          cacheRead: idle || i === 0 ? 0 : context,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
          reasoning: Math.floor(output * 0.3),
          fast: false,
          subagent,
        };
        if (agent === "claude") {
          rec.cacheWrite1h = idle || i === 0 ? context + growth : growth;
        } else {
          rec.input += growth + (idle || i === 0 ? context : 0);
        }
        context = Math.min(context + growth, 400_000);
        if (rnd() < 0.04) context = 25_000; // compaction
        out.push(rec);
      }
    }
  }
  return out;
}
