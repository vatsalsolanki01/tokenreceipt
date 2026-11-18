import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findFiles, num, plausibleTime, safeJson } from "../util.js";
import type { UsageRecord } from "../types.js";

export function geminiRoots(home = os.homedir()): string[] {
  return [path.join(home, ".gemini")];
}

/**
 * Gemini CLI saves chats as ~/.gemini/tmp/<sha256(project root)>/chats/session-*.json.
 * `tokens.input` includes `cached`; `tool` (tool-use prompt) tokens are billed as input;
 * `thoughts` are billed as output.
 * `knownProjects` (paths seen in other agents' logs) lets us turn the hash back into a path.
 */
export async function loadGemini(
  roots: string[] = geminiRoots(),
  knownProjects: Iterable<string> = [],
): Promise<UsageRecord[]> {
  const byHash = new Map<string, string>();
  for (const p of knownProjects) byHash.set(createHash("sha256").update(p).digest("hex"), p);

  const out: UsageRecord[] = [];
  for (const root of roots) {
    const files = (await findFiles(path.join(root, "tmp"), ".json")).filter((f) =>
      f.split(/[\\/]/).includes("chats"),
    );
    for (const file of files) {
      let data: any;
      try {
        data = safeJson(await fs.readFile(file, "utf8"));
      } catch {
        continue;
      }
      if (!data || !Array.isArray(data.messages)) continue;
      const hash =
        typeof data.projectHash === "string" ? data.projectHash : path.basename(path.dirname(path.dirname(file)));
      const project = byHash.get(hash) ?? `gemini:${hash.slice(0, 8)}`;
      const sessionId = String(data.sessionId ?? path.basename(file, ".json"));

      for (const msg of data.messages) {
        const t = msg?.tokens;
        if (!t) continue;
        const ts = Date.parse(msg.timestamp ?? data.startTime);
        if (!plausibleTime(ts)) continue;
        const cached = num(t.cached);
        const thoughts = num(t.thoughts);
        const rec: UsageRecord = {
          agent: "gemini",
          model: typeof msg.model === "string" ? msg.model : "gemini-unknown",
          ts,
          project,
          sessionId,
          input: Math.max(0, num(t.input) - cached) + num(t.tool),
          output: num(t.output) + thoughts,
          cacheRead: cached,
          cacheWrite5m: 0,
          cacheWrite1h: 0,
          reasoning: thoughts,
          fast: false,
          subagent: false,
        };
        if (rec.input + rec.output + rec.cacheRead === 0) continue;
        out.push(rec);
      }
    }
  }
  return out;
}
