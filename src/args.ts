import { parseArgs } from "node:util";
import { AGENTS, type Agent } from "./types.js";

export type View = "day" | "model" | "project" | "session" | "agent";
const VIEWS: View[] = ["day", "model", "project", "session", "agent"];

export interface Options {
  since: number;
  until: number;
  agents: Set<Agent>;
  by?: View;
  html: boolean;
  htmlPath?: string;
  open: boolean;
  json: boolean;
  redact: boolean;
  demo: boolean;
  offline: boolean;
  noColor: boolean;
  help: boolean;
  version: boolean;
}

function parseDate(flag: string, s: string, endOfDay: boolean): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
  if (!d || d.getMonth() !== Number(m![2]) - 1) throw new Error(`${flag} expects a date like 2026-10-01, got "${s}"`);
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** Parse CLI arguments (without the node/script prefix). Throws on invalid input. */
export function parseCli(argv: string[], now = new Date()): Options {
  // `--html` takes an optional file: `--html` or `--html report.html`
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    args.push(argv[i]);
    if (argv[i] === "--html" && argv[i + 1] !== undefined && !argv[i + 1].startsWith("-")) {
      args.push("--out", argv[++i]);
    }
  }

  const { values, positionals } = parseArgs({
    args,
    options: {
      days: { type: "string" },
      since: { type: "string" },
      until: { type: "string" },
      agent: { type: "string" },
      by: { type: "string" },
      html: { type: "boolean" },
      out: { type: "string", short: "o" },
      "no-open": { type: "boolean" },
      json: { type: "boolean" },
      redact: { type: "boolean" },
      demo: { type: "boolean" },
      offline: { type: "boolean" },
      "no-color": { type: "boolean" },
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: true,
  });

  if (positionals.length) throw new Error(`unexpected argument "${positionals[0]}" (see --help)`);

  const by = values.by as View | undefined;
  if (by !== undefined && !VIEWS.includes(by)) {
    throw new Error(`--by must be one of: ${VIEWS.join(", ")}`);
  }

  const agents = new Set<Agent>();
  for (const a of (values.agent ?? AGENTS.join(",")).split(",").map((s) => s.trim().toLowerCase())) {
    if (!a) continue;
    if (!AGENTS.includes(a as Agent)) throw new Error(`unknown agent "${a}" (use: ${AGENTS.join(", ")})`);
    agents.add(a as Agent);
  }
  if (!agents.size) throw new Error(`--agent needs at least one of: ${AGENTS.join(", ")}`);

  let since = values.since ? parseDate("--since", values.since, false) : -Infinity;
  const until = values.until ? parseDate("--until", values.until, true) : Infinity;
  if (values.days !== undefined) {
    const n = Number(values.days);
    if (!Number.isInteger(n) || n < 1) throw new Error(`--days expects a positive whole number, got "${values.days}"`);
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (n - 1));
    since = Math.max(since, d.getTime());
  }
  if (since > until) throw new Error("the date range is empty: it starts after it ends (check --since, --days and --until)");

  return {
    since,
    until,
    agents,
    by,
    html: !!values.html || values.out !== undefined,
    htmlPath: values.out,
    open: !values["no-open"],
    json: !!values.json,
    redact: !!values.redact,
    demo: !!values.demo,
    offline: !!values.offline,
    noColor: !!values["no-color"],
    help: !!values.help,
    version: !!values.version,
  };
}
