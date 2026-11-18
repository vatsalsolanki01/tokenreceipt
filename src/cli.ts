#!/usr/bin/env node
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildReport } from "./aggregate.js";
import { parseCli } from "./args.js";
import { demoRecords, DEMO_PRICES } from "./demo.js";
import { loadLiteLLM, needsLiteLLM, PriceBook } from "./pricing.js";
import { renderHtml } from "./render/html.js";
import { renderBy, renderSummary, setColor } from "./render/terminal.js";
import { loadClaude } from "./sources/claude.js";
import { loadCodex } from "./sources/codex.js";
import { loadGemini } from "./sources/gemini.js";
import type { UsageRecord } from "./types.js";

const VERSION = "0.1.0";

const HELP = `tokenreceipt: see what your AI coding agents really cost. 100% local.

Usage
  npx tokenreceipt [options]

Options
  --days <n>          only the last n days (today included)
  --since <date>      from date, YYYY-MM-DD
  --until <date>      to date, inclusive, YYYY-MM-DD
  --agent <list>      claude,codex,gemini (default: all found)
  --by <view>         day | model | project | session | agent
  --html [file]       write the dashboard and open it (default: temp dir)
  --no-open           with --html, don't open the browser
  --json              print the full report as JSON
  --redact            replace project names with project-1, project-2... (for screenshots)
  --demo              use realistic fake data (try it with no logs)
  --offline           don't download the public price table for non-Claude models
  --no-color          disable colors (also respects NO_COLOR)
  -v, --version
  -h, --help

Examples
  npx tokenreceipt --days 7
  npx tokenreceipt --since 2026-10-01 --by project
  npx tokenreceipt --html --redact

Reads
  Claude Code  ~/.claude/projects, ~/.config/claude/projects, $CLAUDE_CONFIG_DIR
  Codex CLI    ~/.codex/sessions (or $CODEX_HOME)
  Gemini CLI   ~/.gemini/tmp/*/chats
`;

function openFile(file: string): void {
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", '""', `"${file}"`]]
      : process.platform === "darwin"
        ? ["open", [file]]
        : ["xdg-open", [file]];
  try {
    const child = spawn(cmd, args as string[], {
      detached: true,
      stdio: "ignore",
      windowsVerbatimArguments: process.platform === "win32",
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* the path is printed; opening is best-effort */
  }
}

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2));
  if (opts.help) return void process.stdout.write(HELP);
  if (opts.version) return void process.stdout.write(VERSION + "\n");

  // like Node: FORCE_COLOR (any value except 0/false) beats NO_COLOR and a non-TTY; --no-color beats both
  const fc = process.env.FORCE_COLOR;
  const forced = fc !== undefined && fc !== "0" && fc.toLowerCase() !== "false";
  setColor(!opts.noColor && !opts.json && (forced || (!process.env.NO_COLOR && process.stdout.isTTY === true)));

  let records: UsageRecord[];
  let litellm: Record<string, Record<string, unknown>> = {};
  if (opts.demo) {
    records = demoRecords();
    litellm = DEMO_PRICES;
  } else {
    // Claude and Codex are loaded even when filtered out by --agent: their project paths
    // are what turn Gemini's hashed project folders back into names.
    const needAll = opts.agents.has("gemini");
    const [claude, codex] = await Promise.all([
      opts.agents.has("claude") || needAll ? loadClaude() : [],
      opts.agents.has("codex") || needAll ? loadCodex() : [],
    ]);
    const known = new Set([...claude, ...codex].map((r) => r.project));
    const gemini = opts.agents.has("gemini") ? await loadGemini(undefined, known) : [];
    records = [...claude, ...codex, ...gemini];
  }
  records = records.filter((r) => opts.agents.has(r.agent) && r.ts >= opts.since && r.ts <= opts.until);
  if (!opts.demo && needsLiteLLM(records)) litellm = await loadLiteLLM(opts.offline);

  if (!records.length && opts.json) {
    // keep stdout valid JSON so `--json | jq` never breaks
    return void process.stdout.write(JSON.stringify(buildReport([], { demo: opts.demo }), null, 2) + "\n");
  }
  if (!records.length) {
    process.stdout.write(
      "\n  No agent usage found for this selection.\n\n" +
        "  tokenreceipt reads logs from Claude Code (~/.claude/projects), Codex CLI (~/.codex/sessions)\n" +
        "  and Gemini CLI (~/.gemini/tmp). Use an agent first, widen the dates, or try:  npx tokenreceipt --demo\n\n",
    );
    return;
  }

  const priced = new PriceBook(litellm).price(records);
  const report = buildReport(priced, {
    redact: opts.redact,
    demo: opts.demo,
    since: opts.since,
    until: opts.until,
  });

  if (opts.html) {
    const file = path.resolve(opts.htmlPath ?? path.join(os.tmpdir(), "tokenreceipt", "tokenreceipt-report.html"));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, renderHtml(report));
    if (opts.json) {
      process.stderr.write(`tokenreceipt: dashboard written to ${file}\n`);
    } else {
      process.stdout.write(renderSummary(report));
      process.stdout.write(`  Dashboard: ${file}\n\n`);
    }
    if (opts.open) openFile(file);
  }
  if (opts.json) return void process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (opts.html) return;

  process.stdout.write(opts.by ? renderBy(report, opts.by) : renderSummary(report));
}

main().catch((err: unknown) => {
  process.stderr.write(`tokenreceipt: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
