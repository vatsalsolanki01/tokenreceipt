# Changelog

## 0.1.0 (unreleased)

First release.

- Parsers for Claude Code, Codex CLI and Gemini CLI logs.
- Claude prices from Anthropic's official pricing page (checked 2026-10-29), including 5-minute/1-hour cache writes, model-specific cache reads, Haiku 5.5 long-prompt tier, fast mode, US-only inference and web search. Other models are priced from LiteLLM's public table.
- Terminal summary, `--by day|model|project|session|agent`, `--json`, and a self-contained `--html` dashboard with a downloadable receipt-style share card.
- Insights: expired-cache rebuilds (estimated avoidable spend), premium models on light turns (what Sonnet would have saved), context bloat, subagent share, fast-mode premium, web searches, most expensive session.
- `FORCE_COLOR` is respected.
- `--redact` for shareable screenshots, `--demo` for trying it without logs, `--offline`.
- Robust to corrupt lines, unreadable files, impossible timestamps and implausible token counts.
