# Bridge API — Token Durability Fix & Cutover

> **✅ EXECUTED 2026-06-09 (Option A — patch in place).** The hardened `src/` is deployed to the live
> bridge at `C:\dev\exec-coach\bridge-api` (absolute `TOKEN_STORAGE_PATH`), all four providers are
> re-authenticated, and the Google OAuth app is in Production (durable refresh tokens). Rollback
> backup at `src.bak.20260609`. This doc is retained for reference / re-deploy.

**Date:** 2026-06-08. **Purpose:** explain the OAuth re-auth pain, what was fixed, where the *live* bridge actually runs, and the exact steps to make the hardened bridge the single source of truth.

---

## TL;DR

- The bridge you constantly have to re-auth is **not** the repo you're reading — it's an **older copy at `C:\dev\exec-coach\bridge-api`**, started on login by the Windows Scheduled Task **`CoachVicAutoStart`** via `npx tsx src/index.ts`.
- Its live token store (`C:\dev\exec-coach\bridge-api\tokens.json`) right now contains **only `google` (expired ~46 days) and `strava`** — **WHOOP and Withings have been deleted.** That's the delete-tokens-on-any-error bug, caught in the act on the two providers that rotate single-use refresh tokens.
- The **hardened code is in this repo** (`coach-vic-github/bridge-api`). To actually fix the live system, the hardened code has to *run* as the live bridge, with an **absolute token path**, and you **re-authenticate** the wiped providers once.

---

## Live topology (what's running today)

| Piece | Location / detail |
|---|---|
| Live Bridge API (:3000) | `C:\dev\exec-coach\bridge-api`, run as `npx tsx src/index.ts` (PID was 12212) |
| How it starts | Scheduled Task **`CoachVicAutoStart`** → `cmd /c C:\dev\exec-coach\start-coach-vic.bat` (logon trigger) |
| Health watchdog | Scheduled Task **`CoachVicHealthMonitor`** → `monitor-health.ps1` (timed) |
| Token file (live) | `C:\dev\exec-coach\bridge-api\tokens.json` (relative `./tokens.json` resolved against that cwd) |
| OpenClaw gateway | `C:\dev\openclaw\dist\index.js gateway --port 18789` (separate; also started by the .bat) |

**Three bridge copies exist** (this is itself a footgun):
1. `C:\dev\exec-coach\bridge-api` — **LIVE**, older code, relative token path.
2. `C:\Users\gelin\coach-vic-github\bridge-api` — **canonical + hardened (this repo)**.
3. `C:\Users\gelin\coach-vic-e2e-test\coach-vic\bridge-api` — test clone, tokens 80+ days expired.

Because the token path was relative (`./tokens.json`), *which* file is used depends on the launching cwd — a standing source of "suddenly not authenticated."

---

## Root causes (all now fixed in this repo)

1. **Relative token path** → cwd-dependent token file. Fixed: `config.ts` now resolves any unset/relative `TOKEN_STORAGE_PATH` to an absolute, package-root-anchored path; absolute values respected as-is.
2. **Delete-tokens-on-any-error** → a transient blip / 5xx / 429 / rotation race wiped auth (this is why WHOOP + Withings are gone). Fixed: `refreshGuard.isInvalidGrantError()` — tokens are cleared **only** on an explicit `invalid_grant`/`invalid_token` (and Withings status 401); everything else keeps tokens and throws a `RetryableRefreshError`.
3. **Concurrent refresh race** on single-use refresh tokens. Fixed: `refreshGuard.withRefreshLock()` — one in-flight refresh per provider; extra callers await it.
4. **Lost-update / non-atomic writes.** Fixed: `tokenStorage` writes atomically (temp file + `rename`), and **all** read-modify-write mutations are serialized through a single global mutex (`mutate()`) that re-reads from disk before each write — so the 30-min batch refresh can't have one provider's write clobber another's freshly-rotated token.
5. **Boot double-refresh** on restart. Fixed: `tokenRefresh` no longer refreshes immediately on start; it waits a 1–2 min jittered delay.

**Files changed:** `config.ts`, `.env.example`, `storage/tokenStorage.ts`, `services/tokenRefresh.ts`, `services/whoopAuth.ts`, `services/withingsAuth.ts`, `services/stravaAuth.ts`, `services/googleAuth.ts`, **new** `services/refreshGuard.ts`. `npx tsc --noEmit` passes clean.

---

## Current live auth state (what you'll need to re-auth)

| Provider | State | Action needed |
|---|---|---|
| **WHOOP** | **Wiped** (deleted by the bug) | **Re-auth required** |
| **Withings** | **Wiped** (deleted by the bug) | **Re-auth required** |
| **Google** | Present but **expired ~46 days** | Re-auth (refresh likely dead) |
| **Strava** | Present, valid (rotates soon) | Probably fine; re-auth anyway for a clean slate |

> Note: on the *old* live code, Strava's next rotation could also get wiped if it hits any error — another reason to cut over soon.

---

## Cutover — Option A (recommended: patch in place, least disruption)

Reuses your existing autostart + health-monitor infra; just runs hardened code with an absolute token path.

1. **Stop the live bridge** (leave OpenClaw gateway alone):
   - End the `tsx`/node process serving :3000 (or `schtasks /End /TN CoachVicAutoStart` then kill the bridge window), confirming `curl http://127.0.0.1:3000/health` stops responding.
2. **Deploy hardened code** into `C:\dev\exec-coach\bridge-api`:
   - Copy this repo's `bridge-api/src/` over the live `src/` (this brings `refreshGuard.ts` + all fixes). Keep the live `.env` and `tokens.json`.
   - ⚠️ **Parity check first:** the live `src/routes/auth.ts` and `src/routes/coaching.ts` differ from this repo. Diff them and keep any live-only route behavior before overwriting (`git diff --no-index` the two `src` trees).
3. **Set an absolute token path** in `C:\dev\exec-coach\bridge-api\.env`:
   ```
   TOKEN_STORAGE_PATH=C:\dev\exec-coach\bridge-api\tokens.json
   ```
4. **Restart** the bridge (re-run `start-coach-vic.bat`, or re-enable the task) and confirm `GET /health` is OK.
5. **Re-authenticate** (only you can click through) — open each in a browser:
   - WHOOP: http://127.0.0.1:3000/auth/whoop/start
   - Withings: http://127.0.0.1:3000/auth/withings/start
   - Google: http://127.0.0.1:3000/auth/google/start
   - Strava (optional, clean slate): http://127.0.0.1:3000/auth/strava/start
6. **Verify:** `curl http://127.0.0.1:3000/auth/whoop/status` → `authenticated:true`; `curl http://127.0.0.1:3000/whoop/today` returns data.

## Cutover — Option B (cleaner long-term: run the canonical repo under PM2)

Aligns the bridge with how the new coach-service will run.

1. In `coach-vic-github/bridge-api`: `npm install`, `npm run build`.
2. Create `.env` with real secrets **and** `TOKEN_STORAGE_PATH=C:\dev\coach-data\tokens.json` (a single canonical, app-independent location). Migrate the existing `tokens.json` there.
3. `pm2 start dist/index.js --name coach-bridge --cwd C:\Users\gelin\coach-vic-github\bridge-api` (or an `ecosystem.config.cjs`), then `pm2 save`.
4. Repoint `start-coach-vic.bat` / `CoachVicAutoStart` to the PM2 instance instead of `npx tsx` from exec-coach; retire the old `exec-coach\bridge-api`.
5. Re-auth as in Option A, step 5–6.

> Recommendation: **Option A now** to get healthy with minimal risk; fold into **Option B (PM2)** when we stand up the coach-service so the bridge and the new service are managed the same way.

---

## After cutover
- Only **one** bridge instance should ever run, from **one** fixed cwd, with an **absolute** token path.
- Re-auth should now persist: refreshes rotate safely under the mutex, transient errors no longer wipe tokens, and a restart won't double-refresh.
- Delete or clearly archive the two non-live bridge copies to prevent future cwd confusion.
