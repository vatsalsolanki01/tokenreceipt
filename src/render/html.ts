import type { Report } from "../aggregate.js";
import { AGENT_LABEL } from "../types.js";

/** Single-file dashboard. Data is embedded as JSON; all user strings are inserted with textContent. */
export function renderHtml(report: Report): string {
  const data = JSON.stringify({ report, agentLabel: AGENT_LABEL }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>tokenreceipt · AI agent spend</title>
<style>
.viz-root {
  color-scheme: light;
  --surface-0: #f4f3f0; --surface-1: #fcfcfb; --surface-2: #efeeea;
  --border: #e3e2dd; --grid: #e6e5e0;
  --text-primary: #0b0b0b; --text-secondary: #52514e; --text-muted: #77766f;
  --series-1: #2a78d6; --series-2: #eb6834; --series-3: #1baf7a;
  --warning: #b86e00; --accent-bg: #fff6e5;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) .viz-root {
    color-scheme: dark;
    --surface-0: #111110; --surface-1: #1a1a19; --surface-2: #232321;
    --border: #2e2e2b; --grid: #2a2a28;
    --text-primary: #f0efec; --text-secondary: #c3c2b7; --text-muted: #8f8e86;
    --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70;
    --warning: #f0b44c; --accent-bg: #2b2414;
  }
}
:root[data-theme="dark"] .viz-root {
  color-scheme: dark;
  --surface-0: #111110; --surface-1: #1a1a19; --surface-2: #232321;
  --border: #2e2e2b; --grid: #2a2a28;
  --text-primary: #f0efec; --text-secondary: #c3c2b7; --text-muted: #8f8e86;
  --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70;
  --warning: #f0b44c; --accent-bg: #2b2414;
}
* { box-sizing: border-box; }
body { margin: 0; }
.viz-root {
  min-height: 100vh; background: var(--surface-0); color: var(--text-primary);
  font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  padding: 28px 20px 60px;
}
.wrap { max-width: 1120px; margin: 0 auto; display: grid; gap: 16px; }
header { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
header h1 { font-size: 18px; margin: 0; letter-spacing: -0.01em; }
header .range { color: var(--text-secondary); }
header .spacer { flex: 1; }
.badge { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: var(--accent-bg); color: var(--warning); font-weight: 600; }
button { font: inherit; color: var(--text-primary); background: var(--surface-1); border: 1px solid var(--border); border-radius: 8px; padding: 6px 12px; cursor: pointer; }
button:hover { background: var(--surface-2); }
.card { background: var(--surface-1); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; }
.card h2 { font-size: 13px; font-weight: 600; margin: 0 0 12px; color: var(--text-secondary); }
.hero { display: grid; grid-template-columns: minmax(240px, 1.3fr) repeat(4, minmax(120px, 1fr)); gap: 16px; align-items: end; }
.hero .big { font-size: 52px; font-weight: 650; letter-spacing: -0.03em; line-height: 1; }
.hero .label { color: var(--text-secondary); font-size: 13px; margin-bottom: 6px; }
.tile .value { font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
.tile.warn .value { color: var(--warning); }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
@media (max-width: 820px) { .grid2 { grid-template-columns: 1fr; } .hero { grid-template-columns: 1fr 1fr; } }
.legend { display: flex; gap: 16px; flex-wrap: wrap; color: var(--text-secondary); font-size: 12px; margin-bottom: 8px; }
.legend span { display: inline-flex; align-items: center; gap: 6px; }
.sw { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
#daily { position: relative; }
#daily svg { display: block; width: 100%; height: 260px; }
.axis text { fill: var(--text-muted); font-size: 11px; }
.hbars { display: grid; gap: 10px; }
.hrow { display: grid; grid-template-columns: minmax(90px, 38%) 1fr auto; gap: 10px; align-items: center; }
.hrow .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); }
.hrow .track { height: 16px; position: relative; }
.hrow .fill { height: 16px; border-radius: 0 4px 4px 0; background: var(--series-1); min-width: 2px; }
.hrow .val { font-variant-numeric: tabular-nums; color: var(--text-secondary); min-width: 72px; text-align: right; }
.hrow:hover .fill { filter: brightness(1.1); }
.tip { position: fixed; pointer-events: none; background: var(--surface-1); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; font-size: 12px; box-shadow: 0 6px 20px rgba(0,0,0,.12); display: none; z-index: 10; min-width: 160px; }
.tip .t { font-weight: 600; margin-bottom: 4px; }
.tip .r { display: flex; gap: 8px; align-items: center; justify-content: space-between; color: var(--text-secondary); }
.tip .r b { color: var(--text-primary); font-weight: 600; font-variant-numeric: tabular-nums; }
.insight { display: grid; grid-template-columns: 18px 1fr; gap: 8px; padding: 10px 0; border-top: 1px solid var(--border); }
.insight:first-of-type { border-top: 0; padding-top: 0; }
.insight .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--warning); margin-top: 7px; }
.insight .title { font-weight: 600; }
.insight .detail, .insight .hint { color: var(--text-secondary); }
.insight .hint { font-size: 13px; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); white-space: nowrap; }
th { color: var(--text-muted); font-weight: 500; font-size: 12px; }
td.n, th.n { text-align: right; }
.tablewrap { overflow-x: auto; }
details summary { cursor: pointer; color: var(--text-secondary); margin-top: 10px; font-size: 13px; }
.share { display: grid; gap: 12px; justify-items: start; }
.share svg { width: 100%; max-width: 720px; height: auto; border-radius: 12px; border: 1px solid var(--border); }
.foot { color: var(--text-muted); font-size: 12px; }
.empty { color: var(--text-secondary); padding: 40px 0; text-align: center; }
</style>
</head>
<body>
<div class="viz-root">
<div class="wrap">
  <header>
    <h1>tokenreceipt</h1>
    <span class="range" id="range"></span>
    <span id="badge"></span>
    <span class="spacer"></span>
    <button id="theme" type="button">Toggle theme</button>
  </header>

  <section class="card hero" id="hero"></section>

  <section class="card">
    <h2>Daily spend by agent</h2>
    <div class="legend" id="legend"></div>
    <div id="daily"></div>
    <details><summary>Show as table</summary><div class="tablewrap" id="dailyTable"></div></details>
  </section>

  <div class="grid2">
    <section class="card"><h2>Spend by model</h2><div class="hbars" id="models"></div></section>
    <section class="card"><h2>Top projects</h2><div class="hbars" id="projects"></div></section>
  </div>

  <section class="card"><h2>Insights</h2><div id="insights"></div></section>

  <section class="card"><h2>Most expensive sessions</h2><div class="tablewrap" id="sessions"></div></section>

  <section class="card share">
    <h2>Share card</h2>
    <div id="shareCard" style="width:100%"></div>
    <button id="download" type="button">Download PNG</button>
  </section>

  <p class="foot">Costs are API-equivalent: Anthropic list prices, plus the LiteLLM price table for other models. On a subscription plan you are not billed this amount. Generated locally by <b>tokenreceipt</b>; no usage data left your machine.</p>
</div>
<div class="tip" id="tip"></div>
</div>
<script>
const { report: R, agentLabel: AL } = ${data};
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const SVGNS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
const usd = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// axis tick label: enough decimals for the tick step so small budgets don't read "$0 $0 $0"
const tickDecimals = (step) => { for (let d = 0; d < 3; d++) { const x = step * 10 ** d; if (Math.abs(x - Math.round(x)) < 1e-9) return d; } return 2; };
const tickUsd = (n, step) => n >= 1000 ? "$" + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "K" : "$" + n.toFixed(tickDecimals(step));
const compact = (n) => n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : String(Math.round(n));
const AGENT_VAR = { claude: "--series-1", codex: "--series-2", gemini: "--series-3" };
const cssVar = (name) => getComputedStyle(document.querySelector(".viz-root")).getPropertyValue(name).trim();
const fmtDay = (k, opts) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-US", opts || { month: "short", day: "numeric" }); };
const T = R.totals;

// theme toggle: explicit choice wins over OS setting
$("theme").onclick = () => {
  const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = cur === "dark" ? "light" : "dark";
  drawAll();
};

$("range").textContent = R.from ? fmtDay(R.from, { month: "short", day: "numeric", year: "numeric" }) + " – " + fmtDay(R.to, { month: "short", day: "numeric", year: "numeric" }) : "";
if (R.demo) $("badge").append(el("span", "badge", "Demo data"));
else if (R.redacted) $("badge").append(el("span", "badge", "Project names hidden"));

// hero + tiles
(function hero() {
  const h = $("hero");
  const main = el("div");
  main.append(el("div", "label", "API-equivalent spend"), el("div", "big", usd(T.cost)));
  h.append(main);
  const tiles = [
    ["Per active day", usd(T.activeDays ? T.cost / T.activeDays : 0), ""],
    ["Tokens", compact(T.tokens), ""],
    ["Sessions", T.sessions.toLocaleString(), ""],
    ["Est. avoidable", usd(T.avoidable), T.avoidable >= 0.01 ? "warn" : ""],
  ];
  for (const [label, value, cls] of tiles) {
    const t = el("div", "tile " + cls);
    t.append(el("div", "label", label), el("div", "value", value));
    h.append(t);
  }
})();

// tooltip
const tip = $("tip");
function showTip(ev, title, rows) {
  tip.replaceChildren(el("div", "t", title));
  for (const [sw, k, v] of rows) {
    const r = el("div", "r");
    const left = el("span");
    if (sw) { const s = el("span", "sw"); s.style.background = cssVar(sw); left.append(s, " "); }
    left.append(k);
    r.append(left, el("b", null, v));
    tip.append(r);
  }
  tip.style.display = "block";
  const w = tip.offsetWidth, hgt = tip.offsetHeight;
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + w > innerWidth - 8) x = ev.clientX - w - 14;
  if (y + hgt > innerHeight - 8) y = ev.clientY - hgt - 14;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
const hideTip = () => { tip.style.display = "none"; };

// legend (identity never relies on color alone)
(function legend() {
  const lg = $("legend");
  if (R.agents.length < 2) { lg.style.display = "none"; return; }
  for (const a of R.agents) {
    const s = el("span"); const sw = el("span", "sw"); sw.dataset.var = AGENT_VAR[a];
    s.append(sw, AL[a]); lg.append(s);
  }
})();

function niceStep(max, count) {
  const raw = max / count, p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

// path for a column with 4px rounded top, square at the bottom
function colPath(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return "M" + x + "," + (y + h) + "V" + (y + r) + "Q" + x + "," + y + " " + (x + r) + "," + y + "H" + (x + w - r) + "Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + r) + "V" + (y + h) + "Z";
}

function drawDaily() {
  const box = $("daily"); box.replaceChildren();
  const days = R.byDay;
  if (!days.length) { box.append(el("div", "empty", "No usage found.")); return; }
  const W = Math.max(320, box.clientWidth), H = 260, ml = 52, mr = 8, mt = 10, mb = 26;
  const pw = W - ml - mr, ph = H - mt - mb;
  const max = Math.max(...days.map((d) => d.cost), 0.01);
  const step = niceStep(max, 4), top = Math.ceil(max / step) * step;
  const svg = svgEl("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Daily spend by agent" });
  const axis = svgEl("g", { class: "axis" });
  for (let v = 0; v <= top + 1e-9; v += step) {
    const y = mt + ph - (v / top) * ph;
    axis.append(svgEl("line", { x1: ml, x2: W - mr, y1: y, y2: y, stroke: cssVar("--grid"), "stroke-width": 1 }));
    const t = svgEl("text", { x: ml - 8, y: y + 4, "text-anchor": "end" }); t.textContent = tickUsd(v, step); axis.append(t);
  }
  const band = pw / days.length, bw = Math.max(2, Math.min(24, band * 0.7));
  const every = Math.max(1, Math.ceil(days.length / Math.floor(pw / 56)));
  days.forEach((d, i) => {
    // label every Nth day, counted back from the latest so the most recent day is always labeled
    if ((days.length - 1 - i) % every !== 0) return;
    const t = svgEl("text", { x: ml + band * i + band / 2, y: H - 8, "text-anchor": "middle" }); t.textContent = fmtDay(d.key); axis.append(t);
  });
  svg.append(axis);
  const gap = 2;
  days.forEach((d, i) => {
    const x = ml + band * i + (band - bw) / 2;
    let base = mt + ph;
    const segs = R.agents.map((a) => [a, d.byAgent[a] || 0]).filter((s) => s[1] > 0);
    segs.forEach(([a, v], j) => {
      let h = (v / top) * ph;
      const last = j === segs.length - 1;
      const drawH = j > 0 ? Math.max(0, h - gap) : h;
      if (drawH >= 0.5) {
        const y = base - h + (j > 0 ? 0 : 0);
        const p = last ? colPath(x, y, bw, drawH, 4) : "M" + x + "," + y + "h" + bw + "v" + drawH + "h" + (-bw) + "Z";
        svg.append(svgEl("path", { d: p, fill: cssVar(AGENT_VAR[a]) }));
      }
      base -= h;
    });
    const hit = svgEl("rect", { x: ml + band * i, y: mt, width: band, height: ph, fill: "transparent" });
    hit.addEventListener("mousemove", (ev) => showTip(ev, fmtDay(d.key, { weekday: "short", month: "short", day: "numeric" }),
      [[null, "Total", usd(d.cost)], ...R.agents.map((a) => [AGENT_VAR[a], AL[a], usd(d.byAgent[a] || 0)]), [null, "Requests", d.requests.toLocaleString()]]));
    hit.addEventListener("mouseleave", hideTip);
    svg.append(hit);
  });
  box.append(svg);
}

function dailyTable() {
  const t = el("table"); const hr = el("tr");
  for (const h of ["Day", ...R.agents.map((a) => AL[a]), "Total", "Requests"]) hr.append(el("th", h === "Day" ? "" : "n", h));
  t.append(hr);
  for (const d of [...R.byDay].reverse()) {
    if (!d.requests) continue;
    const tr = el("tr"); tr.append(el("td", "", d.key));
    for (const a of R.agents) tr.append(el("td", "n", usd(d.byAgent[a] || 0)));
    tr.append(el("td", "n", usd(d.cost)), el("td", "n", d.requests.toLocaleString()));
    t.append(tr);
  }
  $("dailyTable").replaceChildren(t);
}

function hbars(id, buckets, limit) {
  const box = $(id); box.replaceChildren();
  const list = buckets.slice(0, limit);
  if (!list.length) { box.append(el("div", "empty", "No data")); return; }
  const max = list[0].cost || 1;
  for (const b of list) {
    const row = el("div", "hrow");
    const name = el("div", "name", b.label);
    const track = el("div", "track"); const fill = el("div", "fill"); fill.style.width = (b.cost / max * 100) + "%"; track.append(fill);
    row.append(name, track, el("div", "val", usd(b.cost)));
    row.addEventListener("mousemove", (ev) => showTip(ev, b.label, [[null, "Cost", usd(b.cost)], [null, "Share", (T.cost ? Math.round(b.cost / T.cost * 100) : 0) + "%"], [null, "Requests", b.requests.toLocaleString()], [null, "Input + cache", compact(b.input + b.cacheRead + b.cacheWrite)], [null, "Output", compact(b.output)]]));
    row.addEventListener("mouseleave", hideTip);
    box.append(row);
  }
}

function insights() {
  const box = $("insights");
  if (!R.insights.length) { box.append(el("div", "detail", "Nothing unusual found.")); return; }
  for (const i of R.insights) {
    const row = el("div", "insight"); const body = el("div");
    body.append(el("div", "title", i.title), el("div", "detail", i.detail));
    if (i.tip) body.append(el("div", "hint", "→ " + i.tip));
    row.append(el("div", "dot"), body); box.append(row);
  }
}

function sessions() {
  const t = el("table"); const hr = el("tr");
  for (const [h, c] of [["Started", ""], ["Agent", ""], ["Project", ""], ["Main model", ""], ["Requests", "n"], ["Cost", "n"]]) hr.append(el("th", c, h));
  t.append(hr);
  for (const s of R.sessions.slice(0, 15)) {
    const tr = el("tr");
    tr.append(el("td", "", new Date(s.start).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })),
      el("td", "", AL[s.agent]), el("td", "", s.label), el("td", "", s.model), el("td", "n", s.requests.toLocaleString()), el("td", "n", usd(s.cost)));
    t.append(tr);
  }
  $("sessions").replaceChildren(t);
}

// share card: a paper receipt, pure SVG so it can be rasterized to PNG without any library
function shareSvg() {
  const dark = cssVar("--surface-1") !== "#fcfcfb";
  const bg = dark ? "#151514" : "#ecebe6", fg = dark ? "#f0efec" : "#0b0b0b", mute = dark ? "#a3a29a" : "#52514e";
  const warn = dark ? "#f5a524" : "#b45309";
  const ink = "#1a1a19", inkMute = "#6b6a65", paper = "#fbfaf6";
  const W = 1200, H = 630;
  const s = svgEl("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, xmlns: SVGNS });
  const sans = "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  const text = (x, y, str, size, color, weight, anchor, family) => {
    const t = svgEl("text", { x, y, fill: color, "font-size": size, "font-weight": weight || 400, "font-family": family || sans, "text-anchor": anchor || "start" });
    t.textContent = str; s.append(t); return t;
  };
  s.append(svgEl("rect", { width: W, height: H, fill: bg }));

  // left: the headline
  const total = usd(T.cost);
  const span = T.spanDays === 1 ? "1 day" : T.spanDays + " days";
  text(72, 150, "My AI coding agents cost", 38, mute, 500);
  text(72, 270, total, Math.min(124, Math.floor(560 / (total.length * 0.6))), fg, 700);
  text(72, 325, "API-equivalent · " + span + " · " + compact(T.tokens) + " tokens", 26, mute, 400);
  if (T.avoidable >= 1) {
    text(72, 400, usd(T.avoidable) + " of it was avoidable.", 36, warn, 700);
    text(72, 440, "Expired prompt caches, rebuilt at full price.", 24, mute, 400);
  }
  text(72, 560, "npx tokenreceipt", 34, fg, 700, "start", mono);

  // right: the receipt, with torn zigzag edges
  const rx = 690, rw = 450, top = 28, bottom = 602, tooth = 15;
  let d = "M" + rx + "," + (top + 8);
  for (let x = rx; x < rx + rw; x += tooth) d += "L" + (x + tooth / 2) + "," + top + "L" + Math.min(x + tooth, rx + rw) + "," + (top + 8);
  d += "L" + (rx + rw) + "," + (bottom - 8);
  for (let x = rx + rw; x > rx; x -= tooth) d += "L" + (x - tooth / 2) + "," + bottom + "L" + Math.max(x - tooth, rx) + "," + (bottom - 8);
  d += "Z";
  s.append(svgEl("path", { d, fill: "#000", opacity: dark ? 0.5 : 0.12, transform: "translate(0,6)" }));
  s.append(svgEl("path", { d, fill: paper }));

  const L = rx + 34, R2 = rx + rw - 34, cx = rx + rw / 2;
  let y = 82;
  const rule = () => { s.append(svgEl("line", { x1: L, x2: R2, y1: y - 12, y2: y - 12, stroke: inkMute, "stroke-dasharray": "5 5", "stroke-width": 1.5 })); y += 18; };
  const row = (label, value, opts) => {
    const o = opts || {};
    const size = o.size || 21;
    const lab = label.length > 22 ? label.slice(0, 21) + "…" : label;
    text(L, y, lab, size, o.color || ink, o.weight || 400, "start", mono);
    text(R2, y, value, size, o.color || ink, o.weight || 400, "end", mono);
    y += o.step || 33;
  };
  text(cx, y, "TOKENRECEIPT", 28, ink, 700, "middle", mono); y += 32;
  const crossYear = R.from && R.from.slice(0, 4) !== R.to.slice(0, 4);
  const range = R.from ? fmtDay(R.from, crossYear ? { month: "short", day: "numeric", year: "numeric" } : undefined) + " – " + fmtDay(R.to, { month: "short", day: "numeric", year: "numeric" }) : "";
  text(cx, y, range + (R.demo ? " · DEMO" : ""), 18, inkMute, 400, "middle", mono); y += 40;
  rule();
  for (const b of R.byAgent.slice(0, 3)) row(AL[b.key] || b.label, usd(b.cost));
  rule();
  for (const b of R.byModel.slice(0, 2)) row(b.label, usd(b.cost), { color: inkMute, size: 18, step: 29 });
  y += 4; rule();
  if (T.avoidable >= 0.01) row("WASTED", usd(T.avoidable), { color: "#b45309", weight: 700 });
  row("TOTAL", total, { weight: 700, size: 30, step: 44 });

  // barcode, derived from the total so every receipt looks different
  const seed = String(Math.round(T.cost * 100)) + String(T.requests);
  let bx = L, i = 0;
  while (bx < R2 - 4) {
    const w = 2 + (seed.charCodeAt(i % seed.length) + i * 7) % 4;
    if (i % 2 === 0) s.append(svgEl("rect", { x: bx, y: y - 16, width: w, height: 46, fill: ink }));
    bx += w + 1 + (i * 3 + seed.length) % 3; i++;
  }
  y += 62;
  text(cx, y, "THANK YOU FOR YOUR TOKENS", 16, inkMute, 400, "middle", mono);
  return s;
}

function drawShare() { $("shareCard").replaceChildren(shareSvg()); }

$("download").onclick = () => {
  const svg = shareSvg();
  const xml = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas"); c.width = 1200; c.height = 630;
    c.getContext("2d").drawImage(img, 0, 0);
    const a = document.createElement("a"); a.download = "tokenreceipt.png"; a.href = c.toDataURL("image/png"); a.click();
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
};

function paintSwatches() { document.querySelectorAll(".sw[data-var]").forEach((s) => { s.style.background = cssVar(s.dataset.var); }); }

function drawAll() { paintSwatches(); drawDaily(); drawShare(); }
hbars("models", R.byModel, 8);
hbars("projects", R.byProject, 8);
insights(); sessions(); dailyTable(); drawAll();
let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(drawDaily, 120); });
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", drawAll);
</script>
</body>
</html>
`;
}
