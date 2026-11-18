import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadClaude } from "../src/sources/claude.js";
import { loadCodex } from "../src/sources/codex.js";
import { loadGemini } from "../src/sources/gemini.js";
import { normalizeModel, PriceBook } from "../src/pricing.js";
import { buildReport } from "../src/aggregate.js";
import { demoRecords, DEMO_PRICES } from "../src/demo.js";
import { renderHtml } from "../src/render/html.js";
import type { UsageRecord } from "../src/types.js";
import { parseCli } from "../src/args.js";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

async function tmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "tokenreceipt-test-"));
}

async function write(file: string, lines: unknown[]): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  // strings are written raw so tests can include malformed lines
  await fs.writeFile(file, lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n");
}

const base: UsageRecord = {
  agent: "claude",
  model: "claude-opus-5-5",
  ts: Date.parse("2026-10-20T10:00:00Z"),
  project: "/p",
  sessionId: "s",
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  reasoning: 0,
  fast: false,
  subagent: false,
};

function assistant(id: string, ts: string, usage: object, extra: object = {}) {
  return {
    type: "assistant",
    timestamp: ts,
    sessionId: "sess-1",
    cwd: "/work/app",
    requestId: "req_" + id,
    message: { id: "msg_" + id, model: "claude-opus-5-5", usage },
    ...extra,
  };
}

test("claude: streamed chunks of one response are counted once, keeping the final usage", async () => {
  const root = await tmp();
  const u1 = { input_tokens: 5, output_tokens: 10, cache_read_input_tokens: 1000 };
  const u2 = { ...u1, output_tokens: 300 };
  await write(path.join(root, "projects", "-work-app", "sess-1.jsonl"), [
    { type: "user", message: { content: "hi" } },
    assistant("a", "2026-10-20T10:00:00Z", u1),
    assistant("a", "2026-10-20T10:00:01Z", u2),
    assistant("b", "2026-10-20T10:01:00Z", { input_tokens: 1, output_tokens: 1 }, { cwd: "/work/app/sub" }),
    { type: "assistant", message: { id: "x", model: "<synthetic>", usage: { output_tokens: 9 } }, timestamp: "2026-10-20T10:02:00Z" },
  ]);
  const recs = await loadClaude([root]);
  assert.equal(recs.length, 2);
  const a = recs.find((r) => r.output === 300)!;
  assert.equal(a.cacheRead, 1000);
  // session attributed to the directory it started in, even after `cd sub`
  assert.ok(recs.every((r) => r.project === "/work/app"));
});

test("claude: the same session copied into two config dirs counts once", async () => {
  const r1 = await tmp();
  const r2 = await tmp();
  const lines = [assistant("a", "2026-10-20T10:00:00Z", { input_tokens: 1, output_tokens: 5 })];
  await write(path.join(r1, "projects", "x", "s.jsonl"), lines);
  await write(path.join(r2, "projects", "x", "s.jsonl"), lines);
  assert.equal((await loadClaude([r1, r2])).length, 1);
});

test("claude: cache writes split by TTL and fast mode", async () => {
  const root = await tmp();
  await write(path.join(root, "projects", "x", "s.jsonl"), [
    assistant("a", "2026-10-20T10:00:00Z", {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 300,
      cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 },
      speed: "fast",
    }),
    assistant("b", "2026-10-20T10:00:00Z", { output_tokens: 0, cache_creation_input_tokens: 50 }),
  ]);
  const recs = await loadClaude([root]);
  const a = recs.find((r) => r.fast)!;
  assert.deepEqual([a.cacheWrite5m, a.cacheWrite1h], [100, 200]);
  const b = recs.find((r) => !r.fast)!;
  assert.deepEqual([b.cacheWrite5m, b.cacheWrite1h], [50, 0]);
});

test("codex: cumulative totals become per-request deltas; repeats are ignored", async () => {
  const root = await tmp();
  const tc = (ts: string, total: object) => ({
    timestamp: ts,
    type: "event_msg",
    payload: { type: "token_count", info: { total_token_usage: total } },
  });
  await write(path.join(root, "sessions", "2026", "10", "20", "rollout-1.jsonl"), [
    { timestamp: "2026-10-20T10:00:00Z", type: "session_meta", payload: { id: "c1", cwd: "/work/api" } },
    { timestamp: "2026-10-20T10:00:00Z", type: "turn_context", payload: { model: "gpt-5-codex", cwd: "/work/api" } },
    tc("2026-10-20T10:00:05Z", { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 100 }),
    tc("2026-10-20T10:00:06Z", { input_tokens: 1000, cached_input_tokens: 0, output_tokens: 100 }),
    tc("2026-10-20T10:01:00Z", { input_tokens: 2500, cached_input_tokens: 900, output_tokens: 250, reasoning_output_tokens: 50 }),
    { timestamp: "2026-10-20T10:02:00Z", type: "event_msg", payload: { type: "token_count", info: null } },
  ]);
  const recs = await loadCodex([root]);
  assert.equal(recs.length, 2);
  assert.deepEqual(
    recs.map((r) => [r.input, r.cacheRead, r.output]),
    [
      [1000, 0, 100],
      [600, 900, 150],
    ],
  );
  assert.equal(recs[1].project, "/work/api");
  assert.equal(recs[1].sessionId, "c1");
  assert.equal(recs[1].model, "gpt-5-codex");
});

test("gemini: cached input split out, thoughts billed as output, project hash resolved", async () => {
  const root = await tmp();
  const project = "/work/site";
  const hash = createHash("sha256").update(project).digest("hex");
  await fs.mkdir(path.join(root, "tmp", hash, "chats"), { recursive: true });
  await fs.writeFile(
    path.join(root, "tmp", hash, "chats", "session-1.json"),
    JSON.stringify({
      sessionId: "g1",
      projectHash: hash,
      messages: [
        { type: "user", content: "hi", timestamp: "2026-10-20T10:00:00Z" },
        {
          type: "gemini",
          model: "gemini-2.5-pro",
          timestamp: "2026-10-20T10:00:03Z",
          tokens: { input: 1000, output: 50, cached: 400, thoughts: 20, total: 1070 },
        },
      ],
    }),
  );
  const recs = await loadGemini([root], [project]);
  assert.equal(recs.length, 1);
  assert.deepEqual([recs[0].input, recs[0].cacheRead, recs[0].output], [600, 400, 70]);
  assert.equal(recs[0].project, project);
});

test("pricing: model id normalization", () => {
  assert.equal(normalizeModel("us.anthropic.claude-sonnet-4-5-20250929-v1:0"), "claude-sonnet-4-5");
  assert.equal(normalizeModel("claude-opus-4-5@20251101"), "claude-opus-4-5");
  assert.equal(normalizeModel("claude-opus-5-5[1m]"), "claude-opus-5-5");
});

test("pricing: Opus 5.5 vs Opus 5 prefix match, cache TTL multipliers, fast mode", () => {
  const book = new PriceBook();
  const r = { ...base, input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite5m: 1e6, cacheWrite1h: 1e6 };
  // 4 + 20 + 0.2 + 5 + 8
  assert.equal(Math.round(book.price([r])[0].cost * 100) / 100, 37.2);
  // Opus 5: 5 + 25 + 0.5 + 6.25 + 10
  assert.equal(Math.round(book.price([{ ...r, model: "claude-opus-5" }])[0].cost * 100) / 100, 46.75);
  assert.equal(Math.round(book.price([{ ...r, fast: true }])[0].cost * 100) / 100, 74.4);
});

test("pricing: Haiku 5.5 long-prompt tier", () => {
  const book = new PriceBook();
  const short = book.price([{ ...base, model: "claude-haiku-5-5", input: 100_000 }])[0].cost;
  const long = book.price([{ ...base, model: "claude-haiku-5-5", input: 100_001 }])[0].cost;
  assert.ok(Math.abs(short - 0.01) < 1e-9);
  assert.ok(long > 0.05);
});

test("pricing: unknown model without a price table costs 0 and is reported", () => {
  const priced = new PriceBook().price([{ ...base, agent: "codex", model: "mystery-1", input: 1000 }]);
  assert.equal(priced[0].cost, 0);
  const report = buildReport(priced);
  assert.deepEqual(report.unpricedModels, ["mystery-1"]);
});

test("insights: cache rebuild after the TTL expired is flagged, warm cache is not", () => {
  const t0 = Date.parse("2026-10-20T10:00:00Z");
  const recs: UsageRecord[] = [
    { ...base, ts: t0, cacheWrite1h: 50_000 },
    { ...base, ts: t0 + 10 * 60_000, cacheRead: 50_000, cacheWrite1h: 2_000 },
    // 2 hours later: full re-write
    { ...base, ts: t0 + 130 * 60_000, cacheWrite1h: 60_000 },
  ];
  const report = buildReport(new PriceBook().price(recs));
  const ins = report.insights.find((i) => i.kind === "cache-rebuild")!;
  assert.ok(ins, "expected a cache-rebuild insight");
  // 60K tokens * (8 - 0.2) $/M
  assert.ok(Math.abs(report.totals.avoidable - 0.468) < 1e-6);
});

test("insights: premium-model light turns are priced against Sonnet, not counted as avoidable", () => {
  const recs: UsageRecord[] = [];
  for (let i = 0; i < 100; i++) recs.push({ ...base, ts: base.ts + i * 1000, cacheRead: 100_000, output: 100 });
  // heavy turn: long output, not "light"
  recs.push({ ...base, ts: base.ts + 50_000, cacheRead: 100_000, output: 5_000 });
  // Sonnet and Codex requests are never flagged
  recs.push({ ...base, model: "claude-sonnet-5-5", output: 10, cacheRead: 100_000 });
  const report = buildReport(new PriceBook().price(recs));
  const ins = report.insights.find((i) => i.kind === "premium-light")!;
  assert.ok(ins, "expected a premium-light insight");
  assert.match(ins.detail, /^100 requests/);
  // per light turn: Opus 5.5 = 100K*0.2 + 100*20 = $0.022; Sonnet 5.5 = 100K*0.1 + 100*10 = $0.011
  assert.ok(Math.abs(ins.cost - 100 * 0.011) < 1e-9);
  assert.equal(report.totals.avoidable, 0);

  // fast mode: the premium is reported separately, so the saving is unchanged
  const fast = buildReport(new PriceBook().price(recs.map((r) => ({ ...r, fast: true }))));
  assert.ok(Math.abs(fast.insights.find((i) => i.kind === "premium-light")!.cost - 100 * 0.011) < 1e-9);
});

test("redact hides project paths everywhere", () => {
  const recs = [{ ...base, project: "/secret/client-x", output: 10 }];
  const report = buildReport(new PriceBook().price(recs), { redact: true });
  const html = renderHtml(report);
  assert.ok(!JSON.stringify(report).includes("client-x"));
  assert.ok(!html.includes("client-x"));
});

test("demo data produces a full report and safe HTML", () => {
  const report = buildReport(new PriceBook(DEMO_PRICES).price(demoRecords()), { demo: true });
  assert.ok(report.totals.cost > 0);
  assert.equal(report.agents.length, 3);
  assert.ok(report.byDay.length >= 28);
  const html = renderHtml({ ...report, byProject: [{ ...report.byProject[0], label: "</script><b>x" }] });
  assert.ok(!html.includes("</script><b>x"));
});

test("pricing: matches the official table (Sonnet 5.5 cache read 0.05x, Opus 4.8 fast 2x)", () => {
  const book = new PriceBook();
  const read = book.price([{ ...base, model: "claude-sonnet-5-5", cacheRead: 1e6 }])[0].cost;
  assert.ok(Math.abs(read - 0.1) < 1e-9);
  const fast48 = book.price([{ ...base, model: "claude-opus-4-8", fast: true, input: 1e6, output: 1e6 }])[0].cost;
  assert.ok(Math.abs(fast48 - 60) < 1e-9); // $10 + $50
  // Haiku 4.5 has no fast mode and no geo multiplier
  const h = book.price([{ ...base, model: "claude-haiku-4-5", fast: true, usOnly: true, input: 1e6 }])[0].cost;
  assert.ok(Math.abs(h - 1) < 1e-9);
});

test("pricing: US-only inference is 1.1x on Claude 4.6+, web search is $10 per 1,000", () => {
  const book = new PriceBook();
  const us = book.price([{ ...base, usOnly: true, input: 1e6, output: 1e6 }])[0].cost;
  assert.ok(Math.abs(us - 26.4) < 1e-9); // (4 + 20) * 1.1
  const ws = book.price([{ ...base, webSearches: 250 }])[0].cost;
  assert.ok(Math.abs(ws - 2.5) < 1e-9);
});

test("claude: web searches and inference_geo are read from usage", async () => {
  const root = await tmp();
  await write(path.join(root, "projects", "x", "s.jsonl"), [
    assistant("a", "2026-10-20T10:00:00Z", {
      output_tokens: 1,
      server_tool_use: { web_search_requests: 3 },
      inference_geo: "us",
    }),
  ]);
  const [r] = await loadClaude([root]);
  assert.equal(r.webSearches, 3);
  assert.equal(r.usOnly, true);
});

test("args: options with values work and invalid input is rejected", () => {
  const now = new Date(2026, 9, 29, 15, 0, 0);
  const o = parseCli(["--days", "7", "--agent", "claude,codex", "--by", "project", "--redact"], now);
  assert.equal(new Date(o.since).toDateString(), new Date(2026, 9, 23).toDateString());
  assert.deepEqual([...o.agents], ["claude", "codex"]);
  assert.equal(o.by, "project");
  assert.equal(o.redact, true);

  const h = parseCli(["--html", "out.html", "--no-open"]);
  assert.deepEqual([h.html, h.htmlPath, h.open], [true, "out.html", false]);
  const h2 = parseCli(["--html", "--redact"]);
  assert.deepEqual([h2.html, h2.htmlPath, h2.redact], [true, undefined, true]);

  const s = parseCli(["--since", "2026-10-01", "--until", "2026-10-31"]);
  assert.equal(new Date(s.until).getDate(), 31);
  assert.equal(new Date(s.until).getHours(), 23);

  for (const bad of [
    ["--days", "0"],
    ["--days", "abc"],
    ["--since", "2026/10/01"],
    ["--since", "2026-02-31"],
    ["--since", "2026-10-10", "--until", "2026-10-01"],
    ["--agent", "cursor"],
    ["--by", "week"],
    ["stray"],
    ["--bogus"],
  ]) {
    assert.throws(() => parseCli(bad), Error, bad.join(" "));
  }
});

const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

test("cli: end-to-end runs of the built binary", async () => {
  const j = run("--demo", "--days", "7", "--json");
  assert.equal(j.status, 0, j.stderr);
  const rep = JSON.parse(j.stdout);
  assert.ok(rep.totals.cost > 0 && rep.byDay.length <= 7);

  for (const by of ["day", "model", "project", "session", "agent"]) {
    const r = run("--demo", "--by", by, "--no-color");
    assert.equal(r.status, 0, `${by}: ${r.stderr}`);
    assert.ok(r.stdout.includes("tokenreceipt"));
  }

  const file = path.join(await tmp(), "r.html");
  const h = run("--demo", "--html", file, "--no-open", "--no-color");
  assert.equal(h.status, 0, h.stderr);
  assert.ok((await fs.stat(file)).size > 10_000);

  const bad = run("--days", "x");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--days/);

  assert.match(run("--help").stdout, /Usage/);
  assert.match(run("-v").stdout, /^\d+\.\d+\.\d+/);
});

test("robustness: bogus timestamps and odd Gemini files don't break the report", async () => {
  const root = await tmp();
  await write(path.join(root, "projects", "x", "s.jsonl"), [
    assistant("old", "1970-01-01T00:00:00Z", { output_tokens: 5 }),
    assistant("future", "2099-01-01T00:00:00Z", { output_tokens: 5 }),
    "not json at all",
    assistant("ok", "2026-10-20T10:00:00Z", { output_tokens: 5 }),
  ]);
  const recs = await loadClaude([root]);
  assert.deepEqual(recs.map((r) => r.output), [5]);
  assert.equal(recs.length, 1);

  const g = await tmp();
  await fs.mkdir(path.join(g, "tmp", "abc", "chats"), { recursive: true });
  await fs.writeFile(
    path.join(g, "tmp", "abc", "chats", "s.json"),
    JSON.stringify({ projectHash: 12345, messages: [{ timestamp: "2026-10-20T10:00:00Z", tokens: { input: 10, tool: 5 } }] }),
  );
  await fs.writeFile(path.join(g, "tmp", "abc", "chats", "broken.json"), "{");
  const gr = await loadGemini([g]);
  assert.equal(gr.length, 1);
  assert.equal(gr[0].project, "gemini:abc");
  assert.equal(gr[0].input, 15);
});

test("report: the daily series covers the requested window, idle days included", () => {
  const day = (d: number) => new Date(2026, 9, d, 12).getTime();
  const recs = new PriceBook().price([{ ...base, ts: day(10), output: 1000 }]);
  const report = buildReport(recs, { since: new Date(2026, 9, 5).getTime(), until: new Date(2026, 9, 14, 23, 59).getTime() });
  assert.equal(report.from, "2026-10-05");
  assert.equal(report.to, "2026-10-14");
  assert.equal(report.totals.spanDays, 10);
  assert.equal(report.totals.activeDays, 1);
});

test("cli: --json stays valid JSON when nothing matches", () => {
  const r = run("--demo", "--json", "--since", "2020-01-01", "--until", "2020-01-02");
  assert.equal(r.status, 0, r.stderr);
  const rep = JSON.parse(r.stdout);
  assert.equal(rep.totals.cost, 0);
  assert.deepEqual(rep.byDay, []);
});

test("cli: --version matches package.json", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  const out = spawnSync(process.execPath, [path.join(root, "dist/src/cli.js"), "--version"], { encoding: "utf8" });
  assert.equal(out.stdout.trim(), pkg.version);
});
