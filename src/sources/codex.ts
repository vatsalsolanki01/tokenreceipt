import os from "node:os";
import path from "node:path";
import { findFiles, num, plausibleTime, readLines, safeJson, skipFile } from "../util.js";
import type { UsageRecord } from "../types.js";

export function codexRoots(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string[] {
  return [env.CODEX_HOME ? path.resolve(env.CODEX_HOME) : path.join(home, ".codex")];
}

interface Totals {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
}

const FIELDS = ["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens"] as const;

function diff(cur: Totals, prev: Totals): Totals | undefined {
  const d: Totals = {};
  for (const f of FIELDS) {
    const v = num(cur[f]) - num(prev[f]);
    if (v < 0) return undefined; // counter reset
    d[f] = v;
  }
  return d;
}

/**
 * Codex rollouts emit `event_msg` / `token_count` events whose `total_token_usage`
 * is cumulative for the session (and is sometimes re-emitted unchanged), so each
 * request is costed from the delta between consecutive totals.
 * `input_tokens` includes `cached_input_tokens`; `output_tokens` includes reasoning.
 */
export async function loadCodex(roots: string[] = codexRoots()): Promise<UsageRecord[]> {
  const out: UsageRecord[] = [];
  for (const root of roots) {
    const files = [
      ...(await findFiles(path.join(root, "sessions"), ".jsonl")),
      ...(await findFiles(path.join(root, "archived_sessions"), ".jsonl")),
    ];
    for (const file of files) {
      let model = "unknown";
      let cwd = "";
      let sessionId = path.basename(file, ".jsonl");
      let prev: Totals | undefined;

      try {
        for await (const line of readLines(file)) {
          const o = safeJson(line);
          const p = o?.payload;
          if (!p) continue;
          if (o.type === "session_meta") {
            if (typeof p.cwd === "string") cwd = p.cwd;
            if (typeof p.id === "string") sessionId = p.id;
            if (typeof p.model === "string") model = p.model;
            continue;
          }
          if (o.type === "turn_context") {
            if (typeof p.model === "string") model = p.model;
            if (typeof p.cwd === "string") cwd = p.cwd;
            continue;
          }
          if (o.type !== "event_msg" || p.type !== "token_count" || !p.info) continue;

          const total: Totals | undefined = p.info.total_token_usage;
          const last: Totals | undefined = p.info.last_token_usage;
          let d: Totals | undefined;
          if (total) {
            d = prev ? diff(total, prev) ?? last ?? total : total;
            prev = total;
          } else {
            d = last;
          }
          if (!d) continue;

          const cached = num(d.cached_input_tokens);
          const rec: UsageRecord = {
            agent: "codex",
            model,
            ts: Date.parse(o.timestamp),
            project: cwd || "(unknown)",
            sessionId,
            input: Math.max(0, num(d.input_tokens) - cached),
            output: num(d.output_tokens),
            cacheRead: cached,
            cacheWrite5m: 0,
            cacheWrite1h: 0,
            reasoning: num(d.reasoning_output_tokens),
            fast: false,
            subagent: false,
          };
          if (!plausibleTime(rec.ts)) continue;
          if (rec.input + rec.output + rec.cacheRead === 0) continue;
          out.push(rec);
        }
      } catch (err) {
        skipFile(file, err);
      }
    }
  }
  return out;
}
