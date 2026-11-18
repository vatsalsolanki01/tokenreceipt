import { AGENTS, type Agent, type PricedRecord } from "./types.js";
import { localDay, projectLabel } from "./util.js";
import { isPremiumClaude, promptTokens, sonnetEquivalent, WEB_SEARCH_USD } from "./pricing.js";

export interface Bucket {
  key: string;
  label: string;
  cost: number;
  tokens: number;
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  byAgent: Record<Agent, number>;
}

export interface SessionRow {
  agent: Agent;
  sessionId: string;
  project: string;
  label: string;
  start: number;
  end: number;
  requests: number;
  cost: number;
  model: string;
}

export interface Insight {
  kind: "cache-rebuild" | "premium-light" | "context-bloat" | "subagents" | "fast-mode" | "web-search" | "top-session" | "unpriced";
  title: string;
  detail: string;
  cost: number;
  tip: string;
}

export interface Report {
  generatedAt: string;
  from: string;
  to: string;
  totals: {
    cost: number;
    tokens: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    requests: number;
    sessions: number;
    activeDays: number;
    spanDays: number;
    avoidable: number;
  };
  agents: Agent[];
  byAgent: Bucket[];
  byModel: Bucket[];
  byProject: Bucket[];
  byDay: Bucket[];
  sessions: SessionRow[];
  insights: Insight[];
  unpricedModels: string[];
  redacted: boolean;
  demo: boolean;
}

function emptyBucket(key: string, label: string): Bucket {
  return {
    key,
    label,
    cost: 0,
    tokens: 0,
    requests: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    byAgent: { claude: 0, codex: 0, gemini: 0 },
  };
}

function add(b: Bucket, r: PricedRecord): void {
  const w = r.cacheWrite5m + r.cacheWrite1h;
  b.cost += r.cost;
  b.requests += 1;
  b.input += r.input;
  b.output += r.output;
  b.cacheRead += r.cacheRead;
  b.cacheWrite += w;
  b.tokens += r.input + r.output + r.cacheRead + w;
  b.byAgent[r.agent] += r.cost;
}

export function groupBy(
  records: PricedRecord[],
  keyOf: (r: PricedRecord) => string,
  labelOf: (key: string) => string = (k) => k,
): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const r of records) {
    const k = keyOf(r);
    let b = map.get(k);
    if (!b) map.set(k, (b = emptyBucket(k, labelOf(k))));
    add(b, r);
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost);
}

/** Every calendar day from first to last record, including idle days. */
/**
 * One bucket per calendar day, idle days included. The window runs from the requested
 * start (or the first record) to the requested end (or today), so recent idle days show.
 */
function dailySeries(records: PricedRecord[], window: { start?: number; end?: number }): Bucket[] {
  if (!records.length) return [];
  const days = new Map(groupBy(records, (r) => localDay(r.ts)).map((b) => [b.key, b]));
  const first = records[0].ts;
  const last = records[records.length - 1].ts;
  const start = Number.isFinite(window.start) ? Math.min(window.start!, first) : first;
  const end = Math.max(Number.isFinite(window.end) ? Math.min(window.end!, Date.now()) : Date.now(), last);
  const out: Bucket[] = [];
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const lastKey = localDay(end);
  // records are bounded to 2023..tomorrow by the parsers, so this loop is short
  for (;;) {
    const key = localDay(cur.getTime());
    out.push(days.get(key) ?? emptyBucket(key, key));
    if (key >= lastKey) break;
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

const REBUILD_MIN_TOKENS = 20_000;
const BLOAT_CONTEXT = 150_000;

/**
 * A request that arrives after its session's prompt cache expired, and re-writes a
 * large prefix, paid write price for tokens that would otherwise have been cheap reads.
 */
function cacheRebuildWaste(records: PricedRecord[]): { cost: number; count: number } {
  const sessions = new Map<string, PricedRecord[]>();
  for (const r of records) {
    if (r.cacheWrite5m + r.cacheWrite1h === 0 && r.cacheRead === 0) continue;
    const k = `${r.agent}:${r.sessionId}`;
    (sessions.get(k) ?? sessions.set(k, []).get(k)!).push(r);
  }
  let cost = 0;
  let count = 0;
  for (const list of sessions.values()) {
    list.sort((a, b) => a.ts - b.ts);
    for (let i = 1; i < list.length; i++) {
      const r = list[i];
      const written = r.cacheWrite5m + r.cacheWrite1h;
      if (!r.rate || written < REBUILD_MIN_TOKENS || r.cacheRead >= written) continue;
      const ttl = r.cacheWrite1h > 0 ? 3600_000 : 300_000;
      if (r.ts - list[i - 1].ts <= ttl) continue;
      count++;
      cost +=
        (r.cacheWrite5m * (r.rate.cacheWrite5m - r.rate.cacheRead) +
          r.cacheWrite1h * (r.rate.cacheWrite1h - r.rate.cacheRead)) /
        1e6;
    }
  }
  return { cost, count };
}

const LIGHT_OUTPUT = 300;

/**
 * Premium-model (Opus/Fable) requests whose reply was short. Each one could plausibly have
 * run on Sonnet; `saving` is the price difference. An estimate, so not counted as avoidable.
 */
function premiumLightTurns(records: PricedRecord[]): { count: number; cost: number; saving: number; premiumCost: number } {
  let count = 0;
  let cost = 0;
  let saving = 0;
  let premiumCost = 0;
  for (const r of records) {
    if (r.agent !== "claude" || !r.rate || !isPremiumClaude(r.model)) continue;
    premiumCost += r.cost;
    if (r.output >= LIGHT_OUTPUT) continue;
    count++;
    cost += r.cost;
    // compare at standard speed: the fast-mode premium is reported separately
    const ws = (r.webSearches ?? 0) * WEB_SEARCH_USD;
    const standard = (r.cost - ws) / r.rate.multiplier + ws;
    saving += Math.max(0, standard - sonnetEquivalent(r));
  }
  return { count, cost, saving, premiumCost };
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function buildInsights(records: PricedRecord[], sessions: SessionRow[], total: number): { insights: Insight[]; avoidable: number } {
  const insights: Insight[] = [];

  const rebuild = cacheRebuildWaste(records);
  if (rebuild.count > 0 && rebuild.cost >= 0.01) {
    insights.push({
      kind: "cache-rebuild",
      title: `${usd(rebuild.cost)} re-paid rebuilding expired caches`,
      detail: `${rebuild.count} requests came back after the prompt cache expired and re-wrote 20K+ tokens of context at write price instead of read price.`,
      cost: rebuild.cost,
      tip: "After a long break, start a fresh session or /compact first instead of resuming a huge one.",
    });
  }

  const light = premiumLightTurns(records);
  if (light.count > 0 && light.saving >= 1 && pct(light.cost, light.premiumCost) >= 10) {
    insights.push({
      kind: "premium-light",
      title: `~${usd(light.saving)} less if light turns had run on Sonnet`,
      detail: `${light.count.toLocaleString()} requests on Opus/Fable (${usd(light.cost)}, ${pct(light.cost, light.premiumCost)}% of premium-model spend) produced under ${LIGHT_OUTPUT} tokens of output: tool calls, quick edits, short answers.`,
      cost: light.saving,
      tip: "Use a lighter model (/model sonnet) for routine edits and exploration; switch to Opus for planning and hard bugs.",
    });
  }

  const bloated = records.filter((r) => promptTokens(r) > BLOAT_CONTEXT);
  const bloatCost = bloated.reduce((s, r) => s + r.cost, 0);
  if (bloated.length && pct(bloatCost, total) >= 5) {
    insights.push({
      kind: "context-bloat",
      title: `${pct(bloatCost, total)}% of spend came from requests carrying 150K+ tokens of context`,
      detail: `${bloated.length.toLocaleString()} requests, ${usd(bloatCost)}. Every turn in a long session re-sends the whole history.`,
      cost: bloatCost,
      tip: "Use /clear between unrelated tasks and /compact in long ones.",
    });
  }

  const sub = records.filter((r) => r.subagent).reduce((s, r) => s + r.cost, 0);
  if (sub > 0 && pct(sub, total) >= 3) {
    insights.push({
      kind: "subagents",
      title: `Subagents spent ${usd(sub)} (${pct(sub, total)}%)`,
      detail: "Work delegated to subagents, each with its own context.",
      cost: sub,
      tip: "Point cheap exploration subagents at a smaller model.",
    });
  }

  const fastPremium = records
    .filter((r) => r.fast && r.rate && r.rate.multiplier > 1)
    .reduce((s, r) => s + (r.cost - (r.webSearches ?? 0) * WEB_SEARCH_USD) * (1 - 1 / r.rate!.multiplier), 0);
  if (fastPremium >= 0.01) {
    insights.push({
      kind: "fast-mode",
      title: `Fast mode premium: ${usd(fastPremium)}`,
      detail: "Extra paid for faster output versus standard speed.",
      cost: fastPremium,
      tip: "Turn fast mode off for long unattended runs.",
    });
  }

  const searches = records.reduce((s, r) => s + (r.webSearches ?? 0), 0);
  if (searches * WEB_SEARCH_USD >= 0.5) {
    insights.push({
      kind: "web-search",
      title: `Web searches: ${searches.toLocaleString()} (${usd(searches * WEB_SEARCH_USD)})`,
      detail: "Claude's web search is billed at $10 per 1,000 searches on top of tokens.",
      cost: searches * WEB_SEARCH_USD,
      tip: "",
    });
  }

  const top = sessions[0];
  if (top && total > 0) {
    insights.push({
      kind: "top-session",
      title: `Most expensive session: ${usd(top.cost)} in ${top.label}`,
      detail: `${top.requests.toLocaleString()} requests on ${localDay(top.start)}, mostly ${top.model}.`,
      cost: top.cost,
      tip: "",
    });
  }

  return { insights, avoidable: rebuild.cost };
}

export function buildReport(
  records: PricedRecord[],
  opts: { redact?: boolean; demo?: boolean; since?: number; until?: number } = {},
): Report {
  records = [...records].sort((a, b) => a.ts - b.ts);

  const projectNames = new Map<string, string>();
  const labelFor = (p: string): string => {
    if (!opts.redact) return projectLabel(p);
    if (!projectNames.has(p)) projectNames.set(p, `project-${projectNames.size + 1}`);
    return projectNames.get(p)!;
  };

  const byProject = groupBy(records, (r) => r.project, labelFor);
  if (opts.redact) for (const b of byProject) b.key = b.label;

  const sessMap = new Map<string, SessionRow & { models: Map<string, number> }>();
  for (const r of records) {
    const k = `${r.agent}:${r.sessionId}`;
    let s = sessMap.get(k);
    if (!s) {
      s = {
        agent: r.agent,
        sessionId: opts.redact ? `s${sessMap.size + 1}` : r.sessionId,
        project: opts.redact ? labelFor(r.project) : r.project,
        label: labelFor(r.project),
        start: r.ts,
        end: r.ts,
        requests: 0,
        cost: 0,
        model: r.model,
        models: new Map(),
      };
      sessMap.set(k, s);
    }
    s.end = r.ts;
    s.requests++;
    s.cost += r.cost;
    s.models.set(r.model, (s.models.get(r.model) ?? 0) + r.cost);
  }
  const sessions: SessionRow[] = [...sessMap.values()]
    .map(({ models, ...s }) => ({
      ...s,
      model: [...models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? s.model,
    }))
    .sort((a, b) => b.cost - a.cost);

  const all = groupBy(records, () => "all")[0] ?? emptyBucket("all", "all");
  const byDay = dailySeries(records, { start: opts.since, end: opts.until });
  const { insights, avoidable } = buildInsights(records, sessions, all.cost);

  const unpricedModels = [...new Set(records.filter((r) => !r.rate).map((r) => r.model))];
  if (unpricedModels.length) {
    insights.push({
      kind: "unpriced",
      title: `No price found for ${unpricedModels.length} model(s)`,
      detail: `${unpricedModels.join(", ")}: tokens are counted but cost shows as $0.`,
      cost: 0,
      tip: "Run once with network access so agentreceipt can fetch the LiteLLM price table.",
    });
  }

  const agents = AGENTS.filter((a) => records.some((r) => r.agent === a));

  return {
    generatedAt: new Date().toISOString(),
    from: byDay[0]?.key ?? "",
    to: byDay[byDay.length - 1]?.key ?? "",
    totals: {
      cost: all.cost,
      tokens: all.tokens,
      input: all.input,
      output: all.output,
      cacheRead: all.cacheRead,
      cacheWrite: all.cacheWrite,
      requests: all.requests,
      sessions: sessions.length,
      activeDays: byDay.filter((d) => d.requests > 0).length,
      spanDays: byDay.length,
      avoidable,
    },
    agents,
    byAgent: groupBy(records, (r) => r.agent),
    byModel: groupBy(records, (r) => r.model),
    byProject,
    byDay,
    sessions: sessions.slice(0, 50),
    insights,
    unpricedModels,
    redacted: !!opts.redact,
    demo: !!opts.demo,
  };
}
