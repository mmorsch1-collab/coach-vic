# Coach Vic service

Self-owned Telegram health-coach service that replaces the OpenClaw gateway. Two-way chat +
proactive coaching, powered by Claude (Anthropic API) on top of the Bridge API. See the full
design in [`../docs/COACH_SERVICE_SPEC.md`](../docs/COACH_SERVICE_SPEC.md).

> **✅ Live** under PM2 (`coach-vic`) on `@coach_vic_bot`. Revert with `pm2 stop coach-vic && pm2 start openclaw-gateway`.

## History-aware coaching brain
Beyond chat + scheduling, the coach reasons on your real history (no LLM cost to compute):
- **`src/coaching/metrics.ts`** — e1RM (Epley ≤10 reps / Brzycki >10), per-lift progression + trend, weekly hard-sets per muscle vs evidence-based landmarks, exercise→muscle map.
- **`src/coaching/snapshot.ts`** — a computed digest of current lifts/recovery/body-comp injected into **every** prompt, so it "knows you" without re-deriving. Cached ~10 min; invalidated on a logged set.
- **Tools** (`src/llm/tools.ts`): `log_set` (→ `WORKOUT_DATABASE` with RIR + e1RM), `get_exercise_progression`, `get_muscle_volume`, `get_bodycomp_trend`, `get_workout`, `read_sheet`/`update_sheet_range` (edit workouts), calendar create/update/delete.
- **`src/scheduler/bodyCompSync.ts`** — daily 6 AM Withings→`BODY_COMPOSITION` sync (self-healing backfill) so body-comp trends/cut-rate run on live data.
- **`src/scheduler/weeklyReview.ts`** — Sunday data-rich review (progress, plateau/too-fast-loss/muscle-loss detection).
- Coaching logic (performance-primary autoregulation, RIR/double-progression, home-45lb cap-ladder, mini-cut→maintain + strength-retention guardrail) lives in `workspace/{SCIENCE,WORKOUT_PROTOCOL,GOAL,HEARTBEAT}.md`.

## What it does
- **Two-way Telegram chat** (grammY long-polling; no public webhook) — text Coach Vic anytime,
  share meals, ask questions; replies in Coach Vic's voice with memory + live health data.
- **Proactive coaching** — scheduled jobs (5:15 morning ritual + day-part check-ins) that poll
  the Bridge for free and only call Claude when there's a genuine coachable moment.
- **Memory** — markdown brain + four RAG databases (retrieve before coaching, write back after,
  curate nightly).
- **Reliable delivery** — crash-safe outbound queue with retry/backoff.

## Architecture (one process)
`Telegram ⇄ bot` → `agent (Claude + tools)` → `Bridge API` (health data) · `memory` (files) ·
`scheduler` (node-cron) · `delivery queue`. State persists as atomic JSON (no native deps).

## Setup
1. `npm install`
2. `cp .env.example .env` and fill in: `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_CHAT_ID`, paths. **Use a throwaway test bot token** for pre-swap validation so it
   doesn't fight the live bot for `getUpdates`.
3. Make sure the **Bridge API** is running and authenticated (see `../bridge-api/CUTOVER.md`).

## Validate WITHOUT taking the bot (pre-swap)
- `npm run ritual -- --force` — run the morning ritual against the live Bridge + Claude; prints
  the briefing it would send (builds a real workout sheet + calendar event).
- `npm run chat -- "what should I do today?"` — exercise the full chat loop (tools + memory).
- `npm test` — unit tests.

## Run
- Dev: `npm run dev`
- Prod: `npm run build && pm2 start ecosystem.config.cjs && pm2 save`

## Cutover (single-bot swap, instant revert)
See [`SWAP.md`](SWAP.md). In short: pre-validate → `pm2 stop openclaw-gateway` → start this on
the **real** bot token → revert is `pm2 stop coach-vic && pm2 start openclaw-gateway`.

## Key env
| Var | Meaning |
|---|---|
| `ANTHROPIC_API_KEY` | API key (NOT a Max subscription — see spec §6/§9). |
| `COACH_MODEL_PRIMARY` / `COACH_MODEL_HEAVY` | Haiku for chat/checks, Sonnet for workout programming. |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Bot + the single owner chat served. |
| `BRIDGE_URL` | Bridge API base (default `http://127.0.0.1:3000`). |
| `PROACTIVE_ENABLED` | Master switch for scheduled messages (chat always works). |
| `WORKSPACE_DIR` / `STATE_DIR` | Brain/memory files · operational state. |
| `RETRIEVAL_MODE` | `keyword` (default, zero-dep) or `semantic` (falls back to keyword). |

## Notes / deviations from the spec
- **Anthropic SDK (Messages API + tool loop)** rather than the Agent SDK — lighter and better
  suited to a long-running chat server; full control over tools/loop. Persona/memory/tooling
  are unchanged.
- **Atomic JSON files** for operational state instead of SQLite — zero native build deps
  (no node-gyp), chosen for "just works without intervention." Memory stays markdown.
