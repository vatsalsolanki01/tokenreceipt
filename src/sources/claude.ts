import os from "node:os";
import path from "node:path";
import { findFiles, num, plausibleTime, readLines, safeJson, skipFile } from "../util.js";
import type { UsageRecord } from "../types.js";

/** Config dirs Claude Code may write to. CLAUDE_CONFIG_DIR may hold several, comma-separated. */
export function claudeRoots(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string[] {
  const roots = new Set<string>();
  for (const d of (env.CLAUDE_CONFIG_DIR ?? "").split(",")) {
    if (d.trim()) roots.add(path.resolve(d.trim()));
  }
  roots.add(path.join(home, ".claude"));
  roots.add(path.join(home, ".config", "claude"));
  return [...roots];
}

/**
 * Claude Code logs every assistant content block as its own JSONL line, and each
 * line repeats the request's `usage`. Summing lines naively double/triple counts,
 * so we key by message id and keep the most complete copy (highest output_tokens).
 * Keys are global so the same session copied into two config dirs counts once.
 */
export async function loadClaude(roots: string[] = claudeRoots()): Promise<UsageRecord[]> {
  const byKey = new Map<string, UsageRecord>();
  for (const root of roots) {
    const projectsDir = path.join(root, "projects");
    const files = await findFiles(projectsDir, ".jsonl");
    for (const file of files) {
      const projectDir = path.relative(projectsDir, file).split(/[\\/]/)[0] ?? "";
      try {
        for await (const line of readLines(file)) {
          if (!line.includes('"usage"')) continue;
          const o = safeJson(line);
          if (o?.type !== "assistant") continue;
          const m = o.message;
          const u = m?.usage;
          if (!u || typeof m.model !== "string" || m.model === "<synthetic>") continue;
          const ts = Date.parse(o.timestamp);
          if (!plausibleTime(ts)) continue;

          let w5 = num(u.cache_creation?.ephemeral_5m_input_tokens);
          let w1 = num(u.cache_creation?.ephemeral_1h_input_tokens);
          if (w5 + w1 === 0) w5 = num(u.cache_creation_input_tokens);

          const rec: UsageRecord = {
            agent: "claude",
            model: m.model,
            ts,
            project: typeof o.cwd === "string" && o.cwd ? o.cwd : projectDir,
            sessionId: String(o.sessionId ?? o.session_id ?? path.basename(file, ".jsonl")),
            input: num(u.input_tokens),
            output: num(u.output_tokens),
            cacheRead: num(u.cache_read_input_tokens),
            cacheWrite5m: w5,
            cacheWrite1h: w1,
            reasoning: num(u.output_tokens_details?.thinking_tokens),
            fast: u.speed === "fast",
            subagent: o.isSidechain === true,
            webSearches: num(u.server_tool_use?.web_search_requests),
            usOnly: u.inference_geo === "us",
          };

          const key = m.id ? `${m.id}:${o.requestId ?? ""}` : `line:${o.uuid ?? byKey.size}`;
          const prev = byKey.get(key);
          if (!prev || rec.output > prev.output) byKey.set(key, rec);
        }
      } catch (err) {
        skipFile(file, err);
      }
    }
  }
  return attributeToSessionStart([...byKey.values()]);
}

/**
 * `cwd` follows every `cd` the agent runs, so one session would be split across
 * subfolders. Attribute the whole session to the directory it started in.
 */
function attributeToSessionStart(records: UsageRecord[]): UsageRecord[] {
  const start = new Map<string, { ts: number; project: string }>();
  for (const r of records) {
    const s = start.get(r.sessionId);
    if (!s || r.ts < s.ts) start.set(r.sessionId, { ts: r.ts, project: r.project });
  }
  for (const r of records) r.project = start.get(r.sessionId)!.project;
  return records;
}
