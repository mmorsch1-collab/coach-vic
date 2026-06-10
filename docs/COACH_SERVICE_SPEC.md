# Coach Vic v2 — Full Solution Spec

> **✅ SHIPPED 2026-06-09.** Built, validated on live data, and running under PM2 (`coach-vic`) on
> `@coach_vic_bot`; OpenClaw decommissioned. Implemented in `coach-service/`. This spec reflects the
> as-built design (the original §1–§11 decisions all hold; see `coach-service/README.md` for ops).

**Goal:** Replace OpenClaw with a lean, self-owned service that delivers an *identical* Coach Vic experience (two-way Telegram chat with a Claude coach + proactive nudges), with a **fixed token-refresh layer** and a **M–F 5:15 morning ritual** — while requiring the **minimum possible effort from Matt.**

Status legend: ✅ done · 🟡 in progress · ⬜ to build

---

## 1. Success criteria (what "done" means)

1. **Indistinguishable experience.** Matt texts Coach Vic on Telegram and gets coach-quality replies, can share meals/ask questions all day, and gets proactive nudges — exactly as today. Same Claude models, same voice, same memory.
2. **Reliable.** Messages are never silently lost; the service auto-recovers from restarts, network blips, and provider hiccups.
3. **Fixed refresh.** No more re-auth loops. Tokens survive transient errors and rotation; one re-auth, then it just works.
4. **Morning ritual.** Every weekday at 5:15 AM ET: pull WHOOP + Withings → build a recovery-appropriate workout sheet → attach it to a 5:30 calendar event → send a coach-voice Telegram briefing.
5. **Minimal Matt effort.** Matt's only irreducible tasks: one OAuth re-auth sitting, create one test bot, keep the machine on, approve cutover.
6. **Clean exit.** OpenClaw fully retired only after a parallel run proves parity.

---

## 2. Target architecture

```
                 ┌─────────────────────────────────────────────┐
   Telegram  ◄──►│            coach-service (NEW)               │
   (you chat)    │  PM2 process — replaces openclaw-gateway     │
                 │                                              │
                 │  ┌────────────┐  ┌──────────────────────┐   │
                 │  │ Telegram   │  │  Agent core          │   │
                 │  │ adapter    │─►│  (Claude Agent SDK)  │   │
                 │  │ (grammY,   │◄─│  system = brain files│   │
                 │  │  longpoll) │  │  tools = Bridge MCP  │   │
                 │  └────────────┘  └──────────┬───────────┘   │
                 │  ┌────────────┐             │               │
                 │  │ Scheduler  │─────────────┘               │
                 │  │ (node-cron)│  morning ritual + checks    │
                 │  └────────────┘                             │
                 │  ┌────────────┐  ┌──────────────────────┐   │
                 │  │ Delivery   │  │ State / memory        │   │
                 │  │ queue+retry│  │ (files + sqlite)      │   │
                 │  └────────────┘  └──────────────────────┘   │
                 └──────────────────────┬──────────────────────┘
                                        │ HTTP (127.0.0.1:3000)
                                        ▼
                 ┌─────────────────────────────────────────────┐
                 │   Bridge API (KEPT, HARDENED)               │
                 │   OAuth + data: WHOOP, Withings, Strava,    │
                 │   Google Calendar + Sheets                  │
                 └─────────────────────────────────────────────┘
                                        │
                          Anthropic API (Haiku primary, Sonnet for heavy reasoning)
```

**What changes:** only the "postman" — the OpenClaw gateway is replaced by `coach-service`.
**What stays:** the Bridge API (your data/OAuth layer), Claude (the actual coach), your brain/memory content, your bot, your chat ID.

---

## 3. Components

### 3.1 Bridge API — KEPT + HARDENED 🟡
No functional change to endpoints. Durability fixes (see §6):
- Absolute `TOKEN_STORAGE_PATH` (no more cwd ambiguity).
- Refresh only deletes tokens on a true `invalid_grant`; transient/5xx/429/network errors retain tokens.
- Per-provider refresh single-flight mutex (kills the rotation race).
- Atomic, re-read-before-merge token writes.
- No double refresh on boot.
- Runs as a dedicated PM2 process with a fixed working dir.

### 3.2 coach-service — NEW ⬜
A single always-on TypeScript process. Modules:

**(a) Telegram adapter** — `grammY` (mature TS Telegram lib), **long-polling** `getUpdates` (no public webhook, nothing exposed to the internet). Handles inbound DMs from Matt's chat ID, typing indicators, message chunking, and outbound `sendMessage`. Dedup by Telegram `update_id`.

**(b) Agent core** — Claude **Agent SDK** (`@anthropic-ai/claude-agent-sdk`), authenticated with a **dedicated Anthropic API key** (see §9 / §6.1 for why not the Max subscription). Per turn it assembles:
- System prompt = concatenated brain files (`SOUL`, `IDENTITY`, `USER`, `HEARTBEAT`, `SCIENCE`, `WORKOUT_PROTOCOL`, `HOME_GYM`) + relevant memory.
- Tools = Bridge API exposed as an MCP server (§3.3).
- Model routing = Haiku primary, Sonnet for heavy reasoning (workout programming, weekly review), mirroring today's `openclaw.json`.
- Conversation history for the day for multi-turn continuity.

**Cost/proactivity strategy — LLM calls are gated, not per-poll.** This is the core efficiency win over OpenClaw (which spends a full agent turn on every heartbeat):
- The scheduler polls the **Bridge API as often as desired (free** — it's your own health data, no Claude cost): every 5–10 min is fine.
- A **deterministic, code-only "coachable?" check** runs on each poll (recovery crossed green, strain still flat by mid-morning, weight trend off-target, no workout logged, etc.). No LLM.
- Claude is invoked **only when a real coachable condition fires** (to author the message) plus on inbound chats. Net effect: *more* frequent monitoring with *fewer, higher-value* LLM calls — more proactive coverage at lower cost.

**(c) Memory & continuity** — ported workspace + a real retrieval/write-back/curation loop. **This is fidelity-critical; see §3.4 for the full subsystem spec.** Daily logs (`memory/YYYY-MM-DD.md`), long-term `MEMORY.md`, and the four structured RAG databases are not just stored — they are *searched before coaching* and *updated after*, so "what I ate," nudges, preferences, and patterns persist and compound exactly like now.

**(d) Scheduler / proactive engine** — `node-cron`, TZ `America/New_York`. Ports your existing (currently disabled) jobs as code:
- 5:15 weekday morning ritual (§4) — the headline.
- 7:00 weekday fallback (retry if 5:15 data was stale).
- 10:30 mid-morning, 15:30 afternoon, 20:30 evening check-ins (high-bar, mostly silent).
- 6:00 Withings weight-trend integration.
- Weekend 7:00 review.
Each fires an agent turn with full context; anti-spam state (`heartbeat-state.json`: last nudge time/type, max 3–5/day, 3h cooldown) and quiet hours (21:00–06:00) preserved.

**(e) Delivery queue & reliability** — outbound messages enqueued with retry/backoff so a transient Telegram/network failure doesn't drop a nudge (this is the OpenClaw feature we explicitly match). Crash-safe: PM2 auto-restart; on boot, resume the queue and reschedule cron.

**(f) Config & secrets** — single `.env`: `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID=8062247102`, `BRIDGE_URL=http://127.0.0.1:3000`, model ids, TZ. No secrets in code.

**(g) Observability** — Pino logs (match Bridge), a `/health` check, and a daily self-report to memory. Optional: a Telegram-pingable status command (`/status`).

### 3.3 Bridge MCP wrapper — NEW (thin) ⬜
A small MCP server exposing the Bridge endpoints as typed tools so the Agent SDK can call them natively:
- `whoop_today`, `withings_latest`, `withings_history`, `strava_latest`
- `calendar_today`, `calendar_create_event`
- `coaching_create_workout`, `coaching_get_workout`, `whoop_snapshot`, `whoop_history`, `goals_get`, `sheets_*`
This is mechanical (each tool = one HTTP call to the Bridge).

### 3.4 Memory & RAG subsystem — FIDELITY-CRITICAL ⬜
This is what makes Coach Vic feel like a coach who *knows* Matt. It reproduces the live workspace's retrieval-augmented memory exactly, then hardens it.

**Stores (ported verbatim from `~/.openclaw/workspace`, kept as markdown for fidelity):**
- `memory/YYYY-MM-DD.md` — raw daily logs.
- `MEMORY.md` — curated long-term memory (loaded **only in main/private chat**, never in isolated/shared contexts — §3.5 security rule).
- Four RAG databases with ID'd entries: `CONTEXTUAL_MEMORY_DATABASE.md` (`ctx_*`), `COACHING_INSIGHTS_DATABASE.md` (effectiveness-scored interventions), `PREFERENCES_PROFILE_DATABASE.md` (`PREF_*`, strength-rated), `PERFORMANCE_PATTERNS_DATABASE.md` (`PATTERN_*`, metric/baseline/trend). Plus a `Decision_Log` (per `COACHING_DATABASE_SCHEMA.md`).

**Retrieve (every coaching turn, before generating):** search the databases for context relevant to the message/situation and inject the top hits into the prompt.
- Baseline = the current keyword search (`search_coaching_context.ps1`) reimplemented in the service — guarantees parity.
- **Recommended upgrade (fidelity priority, low extra effort):** swap keyword for **embeddings-based semantic retrieval** (local embedding of each entry; cosine top-k). Strictly better recall ("how do I motivate Matt?" finds the right entries without exact-word matches). Falls back to keyword if embeddings unavailable.

**Write-back (after interactions):** append new `ctx_*` memories, log coaching insights with a 1–5 effectiveness score + "what learned," and update preference strengths / pattern trends — same as the live system's daily updates. Driven by the agent via memory tools.

**Curate (scheduled):** a periodic job (daily light, weekly/monthly deep) consolidates duplicates, updates baselines, and distills daily logs into `MEMORY.md` — replicating the "memory maintenance during heartbeats" loop so the coach keeps getting smarter.

### 3.5 Persona, operating rules & message discipline — ported verbatim ⬜
The "soul" must be the **live** workspace files, not the sanitized repo templates.
- **Persona (CHANGED by Matt — not a verbatim port):** Coach Vic is a **health coach** — calm, confident, grounded, data-driven but human-first; proactive with a high bar; coach-first / data-on-request. **Drop** the executive/Tony-Robbins voice and the WHOOP-VP-of-Product mission entirely ("that ship has sailed"). The sanitized repo `IDENTITY.md`/`SOUL.md` templates already capture this health-coach voice and are the better starting point here than the live exec-coach files.
- **Operating rules (`AGENTS.md`):** per-turn boot sequence (read SOUL → USER → today+yesterday daily notes → MEMORY.md if main session); **session model** — main/private (full memory) vs isolated (cron jobs; no private `MEMORY.md`); "write it down, no mental notes."
- **Message discipline (hard rules, enforced in system prompt + a pre-send check):** the lessons Matt already trained in —
  - Never message without demonstrating knowledge of *today's* context (CI_011).
  - Always verify WHOOP `recovery.metadata.updated_at` freshness before any data claim (CI_012/014).
  - High bar for proactive/automated messages — default to silence (CI_014).
  - Strict internal/external filter: no reasoning, math, or working in sent messages (`MESSAGE_COMPOSITION_STANDARDS.md`, CI_015).
- **Science + protocols:** port `SCIENCE.md`, `WORKOUT_PROTOCOL.md`, `HOME_GYM.md`. **Archive** `VACATION_CUT_PLAN.md` (the April cut is over); genericize protocol references to the cut/VP goal until a new goal is set.

### 3.6 Content refresh (one-time, at migration) ⬜
Persona/mission decisions are now made (above); remaining content cleanup happens *as part of* the port:
- **Retire** the WHOOP-VP mission and the `vacation cut April 22, 2026` goal everywhere they appear (SOUL/USER + memory DB entries like `ctx_011`, `ctx_015`, `PREF_014/015`).
- **Goal = body recomposition to ~10% body fat** (set 2026-06-08): reduce body fat toward ~10% while preserving/adding lean muscle (recomp, not a crash cut). Current ~12% BF. Write this into `GOAL.md`; workout programming and nutrition coaching optimize toward it (chest/upper priority retained from prefs, recovery-gated intensity, protein-forward + modest deficit, simple tracking per Matt's prefs). No fixed deadline unless Matt sets one.
- **Keep** the relationship/coaching learnings that are still true and valuable — coach-first, permission-before-scheduling, sleep is the #1 recovery lever, equipment/working weights, exercise preferences (incline over floor flys), message-discipline lessons. These are persona-independent.
- Reconcile body stats (160 vs 152.5 lbs appear in different files); refresh "WHOOP member ~1 month."
A short guided Q&A with Matt finalizes the new goal when he's ready; I draft, he confirms. The migration is **not blocked** on the goal — we ship goal-agnostic and slot it in later.

---

## 4. The 5:15 morning ritual (headline feature spec)

**Schedule:** `15 5 * * 1-5`, `America/New_York`.

**Sequence (idempotent):**
1. `whoop_today`. **Gate:** if not authenticated, or `recovery.metadata.updated_at` > 2h old, or `score_state !== 'SCORED'` → **stay silent**, log, and let the 7:00 fallback retry. (No "stale data" spam at 5:15.)
2. `withings_latest` (+ `withings_history?days=7` for trend) — body-comp context for the vacation-cut goal.
3. Optionally `whoop_history` / last workout sheet to drive progressive overload and know the current split.
4. **Build the workout** (Sonnet) using `WORKOUT_PROTOCOL` + recovery state:
   - **Green (67–100):** full planned session for today's split, normal volume, progressive overload vs last week.
   - **Yellow (34–66):** moderate — ~20–30% less volume, intensity capped.
   - **Red (0–33):** active recovery / mobility / light or rest.
   - Body-comp trend tunes cardio/nutrition note. Home-gym fallback variant included.
5. `coaching_create_workout {date,title,recovery,exercises}` → returns the **sheet URL**. Per `WORKOUT_PROTOCOL.md`: write into the **canonical spreadsheet only** (`1j50-hDu…`, never a standalone sheet), tab `Workout_YYYY-MM-DD`, matching the existing tab format (Exercise | Set | Last Time | Target Weight | Target Reps | Actual Weight | Actual Reps | Notes), and reference prior weights for progressive overload. First check `coaching_get_workout/:date` to avoid duplicates; update instead of re-create. The **post-workout loop** (Matt reports actuals → service updates the Actual columns + pattern DB) is preserved via chat.
6. `calendar_create_event`: **5:30–6:30 AM ET**, title `🏋️ Workout — <split>`, `description` = sheet URL + 1-line summary. (Skip/patch if an identical event already exists.)
7. **Telegram briefing** (Haiku, coach voice): recovery read (coach-first, with timestamp confidence) → body-comp note only if it changes the plan → today's workout + sheet link + "blocked 5:30" → one question to set the day. No data dumps.

**Failure handling:** any step failing → degrade gracefully (e.g., send the briefing without the calendar link rather than nothing), log, never crash the loop. Hard-auth failure → silent + 7:00 retry.

---

## 5. Experience-parity matrix

| Capability | Today (OpenClaw) | v2 (coach-service) |
|---|---|---|
| Chat with coach anytime | ✅ | ✅ same Claude, same brain |
| "Here's what I ate" → logged + factored in | ✅ | ✅ memory tools |
| Proactive day-part nudges | ✅ (cron, disabled) | ✅ node-cron, ported |
| Morning ritual + workout sheet + meeting | partial | ✅ full, at 5:15 |
| Multi-turn memory / continuity | ✅ | ✅ ported files + session |
| **RAG memory: retrieve-before / write-back / curate** | ✅ | ✅ §3.4 (parity, optional semantic upgrade) |
| **Coach knows me (preferences, patterns, past lessons)** | ✅ | ✅ §3.4 databases + retrieval |
| Persona | exec coach (Tony Robbins × PM) + WHOOP-VP mission | **changed by choice** → calm grounded **health coach**, mission dropped |
| **Message discipline (context-aware, metadata-checked, filtered)** | ✅ (trained-in) | ✅ system rules + pre-send check |
| **Canonical sheet + workout protocol + post-workout loop** | ✅ | ✅ §4 / §3.5 |
| Delivery reliability (queue/retry) | ✅ | ✅ matched deliberately |
| Voice / coaching quality | ✅ Claude | ✅ identical |
| WhatsApp (unused today) | available | not built unless wanted |

---

## 6. Token durability fix (Problem 2) — 🟡 in progress

Being implemented now in `bridge-api`:
- Absolute token path; one canonical PM2 instance (no cwd ambiguity — the current root cause of "not authenticated").
- Keep tokens on transient failures; clear only on real `invalid_grant`.
- Per-provider refresh mutex; atomic writes; no boot double-refresh.
- `CUTOVER.md` will document where the live bridge runs and the one-time re-auth steps.

**One-time Matt step after cutover:** re-auth the 4 services via browser (links provided).

---

## 7. Migration & cutover plan (single-bot swap, instant revert)

**Chosen style:** swap the existing bot from OpenClaw to coach-service, with a one-command revert. (Because two processes can't long-poll the same bot token at once, we don't run both live simultaneously — instead we pre-validate coach-service hard *before* the swap, then flip, keeping OpenClaw intact-but-stopped so reverting is instant.)

1. **Stabilize Bridge** — land token fix, run single PM2 instance, Matt re-auths once. *(System healthy again even before v2.)*
2. **Build coach-service** — all modules above.
3. **Pre-swap validation (no bot conflict)** — exercise coach-service against the live Bridge and Claude without taking the bot: run the 5:15 ritual on demand, replay sample chats via a local harness / temporary throwaway token, verify memory retrieve+write-back, reliability across a forced restart. This replaces a parallel run as the confidence gate.
4. **Swap** — `pm2 stop openclaw-gateway` (frees the bot token), then start `coach-service` on the **same** bot token + chat ID. Coach Vic answers from the new service immediately; experience unchanged to Matt.
5. **Revert (kept ready)** — one step: `pm2 stop coach-service && pm2 start openclaw-gateway`. OpenClaw is left installed, configured, and disabled — not deleted — so any regression rolls back in seconds. A small `revert.md`/script ships with the cutover.
6. **Decommission (only when Matt says so)** — after a satisfied run on the new service: `pm2 delete openclaw-gateway`, remove the OpenClaw cron + security-audit job, archive `~/.openclaw`.

---

## 8. Effort split (optimized for minimal Matt effort)

**Claude builds/does (≈everything):**
- Harden Bridge API + PM2 setup.
- Build coach-service (Telegram, agent core, scheduler, delivery queue, memory).
- Build the Bridge MCP wrapper.
- Port the entire workspace brain + memory.
- Implement + test the 5:15 ritual end-to-end.
- Write run/ops docs; drive the parallel run.

**Matt's irreducible tasks (small, one-time):**
1. **One OAuth sitting** — click 4 links, approve in browser (~5 min). Only you can consent.
2. **Create one test bot** via @BotFather (~2 min) for the parallel run. *(I'll give exact steps; or skip if you accept a brief single-bot swap instead.)*
3. **Set a new goal when ready** (§3.6) — not blocking; we ship goal-agnostic and slot it in via a short Q&A whenever you've decided. I handle the rest of the content cleanup (retire mission/cut goal, fix stats).
4. **Keep the machine on** at 5:15 (same as today) — or say the word and I'll spec moving it to an always-on host.
5. **Approve cutover/decommission** when parity looks good.

> **Optimization order (per Matt):** fidelity to the OpenClaw experience comes first; minimizing Matt's effort second. Where they conflict (e.g., porting the full RAG memory loop and persona vs. a lighter "just store files" approach), this spec chooses fidelity.

---

## 9. Tech stack & dependencies

- Node 20+ / TypeScript (matches Bridge).
- `@anthropic-ai/claude-agent-sdk` (agent loop, tools, sessions).
- `grammY` (Telegram, long-polling).
- `node-cron` (scheduling).
- `better-sqlite3` or flat JSON (state/memory) — JSON to mirror today's file-based memory; sqlite if we want robust queue/dedup.
- PM2 (already installed) for process management + autostart.
- Reuses bot token, Google Sheet, Bridge.

**Auth & cost model (decided):** the bot uses a **dedicated Anthropic API key**, *not* the Max subscription. Automated/third-party agents on subscription OAuth were **banned 2026-04-04** (the action that cut off ~135k OpenClaw instances; Consumer Terms forbid bot access "except via API key"), and from **2026-06-15** subscription Agent SDK usage bills from a separate monthly credit pool at standard API rates — so subscription saves nothing here and risks token revocation. **Max stays for Matt's interactive use** (Claude Code / Claude.ai); the bot is API-keyed. Mixing the two is explicitly allowed. Estimated bot spend ≈ **$15–20/mo on Haiku**, and lower with the gated-LLM strategy (§3.2b): poll the Bridge for free, invoke Claude only on genuine coachable moments + inbound chats.

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Delivery reliability gap vs OpenClaw | Explicit retry queue (SQLite-backed); hard pre-swap validation + instant revert |
| Two pollers / one bot token conflict | Use a test bot during migration; single-bot at cutover only |
| Re-auth pain recurs | Root-caused (cwd + delete-on-transient); fixed in §6 |
| Machine offline at 5:15 | PM2 autostart; optional always-on host; 7:00 fallback |
| Memory/brain fidelity loss | Port files verbatim; parity check on recall |
| Cost creep | Haiku default, Sonnet only for heavy tasks; same profile as today |

---

## 11. Decisions — RESOLVED (2026-06-08)

1. **Goal:** body recomposition → **~10% body fat**, preserve/add muscle (§3.6).
2. **Migration style:** **single-bot swap with instant revert** — pre-validate hard, flip the existing bot to coach-service, keep OpenClaw stopped-but-restorable (§7).
3. **Persona:** calm, grounded **health coach**; WHOOP-VP mission and Tony-Robbins voice dropped (§3.5).
4. **State store:** Matt's call deferred to me ("just make it work, no intervention") → **markdown files for memory/brain** (fidelity) + **atomic JSON files for operational state** (delivery queue, dedup, scheduler state). *Implemented note:* chose JSON over SQLite to avoid native (node-gyp) build deps that can break a machine and need hands-on fixing — same reliability, zero native deps. **Retrieval = keyword** (default, zero-dep) with a semantic hook for later. **LLM via the Anthropic SDK Messages API + tool loop** rather than the Agent SDK (lighter for a long-running chat server; same persona/memory/tools).
5. **Host:** **this machine** is the always-on box (dedicated, tucked away, single-purpose) → PM2 with autostart-on-boot; no move needed.

Everything is specified and buildable. Remaining gate: the background **token-durability fix** landing + Matt's one-time re-auth.
