import type { Bucket, Report, SessionRow } from "../aggregate.js";
import { AGENT_LABEL } from "../types.js";
import { localDay } from "../util.js";

let color = true;
export function setColor(on: boolean): void {
  color = on;
}

const sgr = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = sgr("1");
const dim = sgr("2");
const green = sgr("32");
const yellow = sgr("33");
const cyan = sgr("36");
const AGENT_COLOR = { claude: sgr("34"), codex: sgr("33"), gemini: sgr("32") };

export const usd = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

export function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

// eslint-disable-next-line no-control-regex
const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
const padEnd = (s: string, w: number) => s + " ".repeat(Math.max(0, w - visible(s)));
const padStart = (s: string, w: number) => " ".repeat(Math.max(0, w - visible(s))) + s;
const trunc = (s: string, w: number) => (s.length > w ? s.slice(0, w - 1) + "…" : s);

function bar(frac: number, width: number): string {
  const full = Math.round(Math.max(0, Math.min(1, frac)) * width);
  return "█".repeat(full) + dim("░".repeat(width - full));
}

function table(headers: string[], rows: string[][], align: ("l" | "r")[]): string {
  const widths = headers.map((h, i) => Math.max(visible(h), ...rows.map((r) => visible(r[i]))));
  const fmt = (cells: string[]) =>
    "  " + cells.map((c, i) => (align[i] === "r" ? padStart(c, widths[i]) : padEnd(c, widths[i]))).join("  ");
  return [dim(fmt(headers)), ...rows.map(fmt)].join("\n");
}

function fmtDate(day: string): string {
  if (!day) return "";
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function section(title: string): string {
  return "\n" + bold(cyan(title.toUpperCase()));
}

function bucketTable(buckets: Bucket[], firstCol: string, limit: number): string {
  const total = buckets.reduce((s, b) => s + b.cost, 0);
  const rows = buckets.slice(0, limit).map((b) => [
    trunc(b.label, 34),
    b.requests.toLocaleString(),
    compact(b.input + b.cacheRead + b.cacheWrite),
    compact(b.output),
    usd(b.cost),
    `${total > 0 ? Math.round((b.cost / total) * 100) : 0}%`,
  ]);
  return table([firstCol, "requests", "input+cache", "output", "cost", "share"], rows, ["l", "r", "r", "r", "r", "r"]);
}

function sessionTable(sessions: SessionRow[], limit: number): string {
  const rows = sessions.slice(0, limit).map((s) => [
    localDay(s.start),
    AGENT_LABEL[s.agent],
    trunc(s.label, 26),
    trunc(s.model, 22),
    s.requests.toLocaleString(),
    usd(s.cost),
  ]);
  return table(["started", "agent", "project", "main model", "requests", "cost"], rows, ["l", "l", "l", "l", "r", "r"]);
}

export function renderSummary(r: Report): string {
  const t = r.totals;
  const out: string[] = [];
  const tag = r.demo ? yellow(" [DEMO DATA]") : r.redacted ? dim(" [redacted]") : "";
  out.push("");
  out.push(`  ${bold("agentreceipt")} ${dim("· what your AI coding agents cost (API-equivalent)")}${tag}`);
  out.push(
    `  ${dim(`${fmtDate(r.from)} – ${fmtDate(r.to)} · ${plural(t.activeDays, "active day")} · ${plural(t.sessions, "session")} · ${plural(t.requests, "request")}`)}`,
  );
  out.push("");
  out.push(
    `  ${bold(green(usd(t.cost)))} total    ${bold(usd(t.activeDays ? t.cost / t.activeDays : 0))} ${dim("per active day")}    ${bold(compact(t.tokens))} ${dim("tokens")}`,
  );
  if (t.avoidable >= 0.01) {
    out.push(`  ${yellow("▲")} ${bold(yellow(usd(t.avoidable)))} ${dim("estimated avoidable (see insights)")}`);
  }

  if (r.byAgent.length > 1) {
    out.push(section("By agent"));
    const max = Math.max(...r.byAgent.map((b) => b.cost), 0);
    for (const b of r.byAgent) {
      const a = b.key as keyof typeof AGENT_LABEL;
      out.push(
        `  ${padEnd(AGENT_LABEL[a], 12)} ${AGENT_COLOR[a](bar(max ? b.cost / max : 0, 24))}  ${padStart(usd(b.cost), 11)}  ${dim(`${t.cost ? Math.round((b.cost / t.cost) * 100) : 0}%`)}`,
      );
    }
  }

  out.push(section("By model"));
  out.push(bucketTable(r.byModel, "model", 8));

  out.push(section("Top projects"));
  out.push(bucketTable(r.byProject, "project", 8));

  const recent = r.byDay.slice(-14);
  if (recent.length) {
    out.push(section(`Last ${recent.length} days`));
    const max = Math.max(...recent.map((d) => d.cost), 0);
    for (const d of recent) {
      const [y, m, dd] = d.key.split("-").map(Number);
      const label = new Date(y, m - 1, dd).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "2-digit" });
      out.push(`  ${dim(padEnd(label, 11))} ${green(bar(max ? d.cost / max : 0, 30))} ${padStart(usd(d.cost), 10)}`);
    }
  }

  if (r.insights.length) {
    out.push(section("Insights"));
    for (const i of r.insights) {
      out.push(`  ${yellow("●")} ${bold(i.title)}`);
      out.push(`    ${dim(i.detail)}`);
      if (i.tip) out.push(`    ${dim("→ " + i.tip)}`);
    }
  }

  out.push("");
  out.push(
    dim(
      "  Prices: Anthropic list prices + LiteLLM table. On a subscription you are not billed this; it is what the same usage costs on the API.",
    ),
  );
  out.push(`  ${dim("Next:")} agentreceipt --html ${dim("(dashboard)")} · --by session|project|model|day · --redact ${dim("(hide names for screenshots)")}`);
  out.push("");
  return out.join("\n");
}

export function renderBy(r: Report, by: "day" | "model" | "project" | "session" | "agent"): string {
  const head = `\n  ${bold("agentreceipt")} ${dim(`· by ${by} · ${fmtDate(r.from)} – ${fmtDate(r.to)} · total ${usd(r.totals.cost)}`)}\n`;
  switch (by) {
    case "day":
      return head + bucketTable([...r.byDay].reverse().filter((d) => d.requests > 0), "day", 10_000) + "\n";
    case "model":
      return head + bucketTable(r.byModel, "model", 10_000) + "\n";
    case "project":
      return head + bucketTable(r.byProject, "project", 10_000) + "\n";
    case "agent":
      return head + bucketTable(r.byAgent.map((b) => ({ ...b, label: AGENT_LABEL[b.key as keyof typeof AGENT_LABEL] })), "agent", 10) + "\n";
    case "session":
      return head + sessionTable(r.sessions, 50) + "\n";
  }
}
