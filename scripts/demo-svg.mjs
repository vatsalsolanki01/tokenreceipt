// Renders `agentreceipt --demo` into an animated terminal SVG for the README (docs/demo.svg).
// Usage: npm run build && node scripts/demo-svg.mjs
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = spawnSync(process.execPath, [path.join(root, "dist/src/cli.js"), "--demo"], {
  env: { ...process.env, FORCE_COLOR: "1" },
  encoding: "utf8",
});
if (out.status !== 0) throw new Error(out.stderr);

// keep the sections that tell the story; drop the long tables and footer
const KEEP = new Set(["", "BY AGENT", "BY MODEL", "INSIGHTS"]);
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
let section = "";
const lines = [];
for (const raw of out.stdout.split("\n")) {
  const plain = strip(raw);
  if (/^[A-Z][A-Z0-9 ]+$/.test(plain)) section = plain;
  if (/^\s+(Prices:|Next:)/.test(plain)) continue;
  if (KEEP.has(section)) lines.push(raw);
}
while (lines.length && !strip(lines[lines.length - 1]).trim()) lines.pop();

// ANSI -> styled segments
const COLORS = { 32: "#56d364", 33: "#e3b341", 34: "#6cb6ff", 36: "#39c5cf" };
function segments(line) {
  const segs = [];
  let style = {};
  for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
    const m = part.match(/^\x1b\[([0-9;]*)m$/);
    if (m) {
      for (const c of m[1].split(";").map(Number)) {
        if (c === 0) style = {};
        else if (c === 1) style = { ...style, bold: true };
        else if (c === 2) style = { ...style, dim: true };
        else if (COLORS[c]) style = { ...style, color: COLORS[c] };
      }
    } else if (part) segs.push({ text: part, ...style });
  }
  return segs;
}

// soft-wrap long lines at word boundaries, continuing with the same indent
const COLS = 104;
function wrap(segs) {
  const plain = segs.map((s) => s.text).join("");
  if (plain.length <= COLS) return [segs];
  const indent = plain.match(/^\s*/)[0].length;
  const rows = [];
  let row = [], len = 0;
  const push = () => { rows.push(row); row = [{ text: " ".repeat(indent) }]; len = indent; };
  for (const s of segs) {
    for (const word of s.text.split(/(?<= )/)) {
      if (len + word.trimEnd().length > COLS && len > indent) push();
      row.push({ ...s, text: word });
      len += word.length;
    }
  }
  rows.push(row);
  return rows;
}

const rows = lines.flatMap((l) => wrap(segments(l)));
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const FONT = 14, LH = 20, CW = 8.43, PAD = 24, TOP = 52;
const CMD = "npx agentreceipt --demo";
const W = Math.ceil(PAD * 2 + COLS * CW);
const H = TOP + (rows.length + 2) * LH + PAD;

// timeline (seconds): type the command, pause, print lines, hold, loop
const DUR = 16, TYPE0 = 0.6, TYPE_STEP = 0.06, OUT0 = TYPE0 + CMD.length * TYPE_STEP + 0.5, LINE_STEP = 0.07;
const pct = (t) => ((t / DUR) * 100).toFixed(2);
let css = "";
const reveal = (cls, t) => {
  css += `.${cls}{animation:${cls} ${DUR}s steps(1,end) infinite}@keyframes ${cls}{0%,${pct(t)}%{opacity:0}${(+pct(t) + 0.01).toFixed(2)}%,96%{opacity:1}96.01%,100%{opacity:0}}\n`;
};

let body = "";
// prompt + typed command
body += `<text x="${PAD}" y="${TOP}" class="t"><tspan fill="#56d364">$</tspan></text>`;
[...CMD].forEach((ch, i) => {
  reveal(`c${i}`, TYPE0 + i * TYPE_STEP);
  body += `<text x="${(PAD + (i + 2) * CW).toFixed(1)}" y="${TOP}" class="t c${i}">${esc(ch)}</text>`;
});
rows.forEach((segs, i) => {
  reveal(`l${i}`, OUT0 + i * LINE_STEP);
  const tspans = segs
    .map((s) => {
      const a = [];
      if (s.color) a.push(`fill="${s.color}"`);
      if (s.bold) a.push(`font-weight="700"`);
      if (s.dim) a.push(`fill-opacity="0.6"`);
      return `<tspan ${a.join(" ")}>${esc(s.text)}</tspan>`;
    })
    .join("");
  body += `<text x="${PAD}" y="${TOP + (i + 1) * LH}" class="t l${i}" xml:space="preserve">${tspans}</text>`;
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="agentreceipt --demo terminal output">
<style>
.t{font:${FONT}px ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;fill:#e6edf3;white-space:pre}
${css}</style>
<rect width="${W}" height="${H}" rx="10" fill="#0d1117"/>
<circle cx="20" cy="18" r="6" fill="#ff5f57"/><circle cx="40" cy="18" r="6" fill="#febc2e"/><circle cx="60" cy="18" r="6" fill="#28c840"/>
${body}
</svg>
`;
writeFileSync(path.join(root, "docs/demo.svg"), svg);
console.log(`docs/demo.svg: ${rows.length} lines, ${W}x${H}, ${(svg.length / 1024).toFixed(1)} kB`);
