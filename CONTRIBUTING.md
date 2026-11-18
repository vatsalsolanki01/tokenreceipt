# Contributing

Thanks for helping! The most valuable contributions are **new agent parsers** and **"my numbers look wrong" reports** with details.

## Setup

```bash
npm install
npm test                       # builds with tsc and runs node --test
node dist/src/cli.js --demo    # try it
node dist/src/cli.js           # run against your own logs
```

No runtime dependencies, please. `npx agentreceipt` should stay instant.

## Adding an agent

1. Create `src/sources/<agent>.ts` exporting `load<Agent>(roots?)` that returns `UsageRecord[]` (see `src/types.ts`).
   - One record per API request.
   - Token fields must not overlap: `input` is **uncached** input; cached input goes in `cacheRead`; reasoning tokens are included in `output`.
   - If the agent logs cumulative counters, cost the delta (see `sources/codex.ts`).
   - If it logs the same response more than once, dedupe (see `sources/claude.ts`).
2. Add the agent to `Agent`, `AGENTS` and `AGENT_LABEL` in `src/types.ts`, and load it in `src/cli.ts`.
3. Add a fixture-based test in `test/`, using a minimal fake log written to a temp dir. **Never commit real logs.**
4. Mention the log location in the README table.

## Prices

Claude prices live in `src/pricing.ts` (`CLAUDE_PRICES`). Other models come from the LiteLLM table at runtime. If a price is wrong, please link the official pricing page in your PR.

## Reporting wrong numbers

Run `npx agentreceipt --json --redact` and include the per-model totals, your agent version, and what you expected (e.g. Claude Code's `/cost`). Please don't paste raw logs: they contain your code and prompts.
