import { createReadStream, promises as fs } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";

/** Recursively list files under `root` ending with `ext`. Missing dirs yield []. */
export async function findFiles(root: string, ext: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && e.name.endsWith(ext)) out.push(p);
    }
  }
  await walk(root);
  return out;
}

export async function* readLines(file: string): AsyncGenerator<string> {
  const rl = createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) if (line) yield line;
}

export function safeJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** No single API request uses a trillion tokens; anything above that is a corrupt value. */
const MAX_TOKENS = 1e12;

/** A non-negative token count, or 0 for anything missing, malformed or implausible. */
export function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v < MAX_TOKENS ? v : 0;
}

export function localDay(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Last path segment of a project path, for display. Handles both / and \ separators. */
export function projectLabel(project: string): string {
  const parts = project.split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : project || "(unknown)";
}

/** 2023-01-01: no coding agent logs predate this. Anything earlier, or >1 day ahead, is a corrupt timestamp. */
const EARLIEST = Date.UTC(2023, 0, 1);

export function plausibleTime(ts: number): boolean {
  return Number.isFinite(ts) && ts >= EARLIEST && ts <= Date.now() + 86_400_000;
}

/** A locked, deleted or unreadable log file shouldn't abort the whole report. */
export function skipFile(file: string, err: unknown): void {
  if (process.env.TOKENRECEIPT_DEBUG) {
    process.stderr.write(`tokenreceipt: skipped ${file}: ${err instanceof Error ? err.message : String(err)}
`);
  }
}
