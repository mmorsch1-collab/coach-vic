# Coach Vic v2 — Status & Remaining Tasks

_Last updated: 2026-06-09. Coach Vic v2 is **LIVE** — running on your own stack, talking to `@coach_vic_bot`._

## ✅ Done this build
- **Bridge API hardened** (absolute token path, refresh single-flight mutex, atomic writes, clear-only-on-`invalid_grant`, no boot double-refresh) — deployed to the live bridge at `C:\dev\exec-coach\bridge-api`.
- **All 4 data sources reconnected + durable:** WHOOP, Withings (correct account `25424499`), Strava, Google. **Google app moved to Production** (kills the 7-day refresh-token expiry that caused the recurring re-auth).
- **`coach-service` built and live** under PM2 (`coach-vic`), polling the real bot — two-way chat + proactive coaching, on the Anthropic API.
- **OpenClaw decommissioned:** gateway killed, watchdog no longer resurrects it, removed from autostart + PM2. Reboot persistence via `pm2 resurrect` in `start-coach-vic.bat`.
- **History-aware coaching:** computed snapshot (e1RM/progression/volume/trends) every message; `log_set` accumulates to `WORKOUT_DATABASE`; exercise/volume/body-comp history tools; daily Withings→`BODY_COMPOSITION` sync (backfilled).
- **Science-reviewed coaching logic** (Israetel/Nippard/Helms panel): performance-primary autoregulation, RIR + double-progression + home-45lb cap-ladder (gym uncapped), volume landmarks, mesocycle/deload; nutrition = mild mini-cut→maintain, protein ~165g, rate band + hard stop, strength-retention guardrail.
- **Self-healing:** hourly auth watchdog (Telegram re-auth alert), weekly dependency audit, calendar-link gid stability, bot 409-resilience.
- **Reviewed:** high-effort code review run twice; all confirmed bugs fixed; typecheck + build clean.

## 🔧 Optional, when you want them (nothing is blocking)
1. **Commit the work.** Everything is staged but **not committed**. To save it to a branch (off `main`, no push):
   ```
   git checkout -b coach-vic-v2 && git commit -m "Coach Vic v2: self-owned service, hardened bridge, history-aware coaching"
   ```
2. **Cost tuning** (optional): set `COACH_MODEL_HEAVY=claude-haiku-4-5` in `coach-service/.env` to roughly halve cost (~$5–8/mo vs ~$8–15), or ask me to add a hard monthly budget cap.
3. **Verify reboot persistence** next time you restart the machine (bridge + coach-vic should come up; OpenClaw should not).
4. **Delete leftovers** once you're confident: the rollback backup `C:\dev\exec-coach\bridge-api\src.bak.20260609`, and the stale clone `C:\Users\gelin\coach-vic-e2e-test` (contains 80-day-expired tokens — minor hygiene).
5. **Cloud `/code-review ultra`** if you want a second opinion (the cloud service was rate-limited during this session; the local high-effort review stands).
6. **Set a specific goal target** anytime (e.g. a date, exact BF%) and I'll tune `GOAL.md`.

## How to use it
Just text **@coach_vic_bot**. It's proactive (M–F 5:15 ritual + day-part checks + Sunday review) and reactive (ask anything, share meals, report workouts — "log incline bench 185x8x7x6"). Revert to OpenClaw any time with `pm2 stop coach-vic && pm2 start openclaw-gateway`.
