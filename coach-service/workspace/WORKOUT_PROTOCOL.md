# WORKOUT_PROTOCOL.md — Structured Workout Creation

Every workout follows this. No shortcuts, no standalone sheets.

## Canonical spreadsheet
- **ID:** `1j50-hDu86wvVQwEO6sckxVkaqI-QS1Ej4Z7s6682bx0`
- Every tab (workouts, goals, body comp, WHOOP history) lives HERE.
- Tab name: `Workout_YYYY-MM-DD` (date of the workout). Match existing tab format.

## Step 1 — Data refresh
1. **Withings latest** — weight, body fat %, muscle mass. Assess vs the ~10% BF
   recomposition goal (GOAL.md). Flag if weight is dropping fast or muscle is falling.
2. **WHOOP today** — recovery %, HRV, RHR, sleep, strain. Verify metadata freshness
   (<2h, SCORED). Classify recovery: green 67–100 / yellow 34–66 / red 0–33.

## Step 2 — Pattern review (use real history)
- Use `get_exercise_progression` (and `get_workout` for the most recent session) to pull the
  **actual weights/reps Matt logged** last time for the same lifts. Ground every prefilled
  target in that real data — don't guess.
- Use `get_whoop_history` for multi-day recovery/strain context.
- Check muscle-group balance (have we hit chest 2x this week?) and weak/stalling lifts.

## Current program frame (job-transition window)
- **5×/week lifting, Mon–Fri** — chest/back/shoulders/arms/legs split with **chest 2×/week**;
  legs maintenance volume. Weekend: Zone-2 running/steps (recovery, not strain).
- Hockey on Friday nights (occasional — ask, and keep Friday's session joint-friendly).
- This is the high-consistency window for the recomposition cut — protect it.

## Step 3 — Autoregulation (PERFORMANCE-primary, recovery-modifier)
Do NOT cut weekly volume based on WHOOP color. Plan volume weekly per muscle; autoregulate
intensity. (See SCIENCE.md.)
- **Priority:** chest/upper (weak point + preference), 2×/week. Legs maintenance only.
- **Volume:** target the weekly hard-set landmarks per muscle (use `get_muscle_volume`): chest/back
  ~10–16, legs ~6–8. Protect this; don't slash it on a yellow day.
- **While GOAL.md says deficit:** plan each muscle in the LOWER HALF of its band (chest, as the
  priority, may sit mid-band). Hold sets flat week to week — do NOT accumulate sets toward MAV
  until maintenance. In a cut you trim fatigue, never intensity: load stays heavy.
- **Session cap ~10 hard sets per muscle.** If the weekly landmark won't fit in one day, push the
  overflow to a second day (rear-delt/upper-back volume on shoulders day; chest's 2nd weekly hit
  as 3–4 sets on another upper day).
- **Progression (double progression):** add reps to the top of the range → then load.
  - **At the GYM (barbell/rack/machines/cables — NO cap):** progress load normally once reps hit
    the top of the range. This is the default for heavy compounds; prefer the gym for lifts that
    have outgrown home weights.
  - **At HOME only (dumbbells cap at 45 lb):** when a lift hits the top of the range at 45 lb,
    escalate before declaring a stall: reps→~20 → tempo → ROM/stretch → pauses/1.5-reps →
    mechanical drop sets → density; at ~20 clean reps × 2 sessions, that lift has outgrown home —
    **route it to the gym** for real load progression.
- **Rep windows (double progression happens INSIDE these — prefill Reps from them):**
  | Class | Reps | Rest |
  |---|---|---|
  | Heavy compound — press / row / pulldown / squat / hinge | 6–10 | 2–3 min |
  | Secondary compound / machine / DB accessory | 8–15 | ~2 min |
  | Isolation — curls, flys, face pulls, laterals, pushdowns | 12–20 | 60–90 s |
  Prefill rep target = last session's reps +1 toward the window top (yellow/red day: hold last
  session's numbers — but then the LOAD must already be right). Reps under the window bottom two
  sessions running → drop load ~5–10% to re-enter the window (normal in a deficit; not a stall).
- **Order:** plank → 2–3 ramp sets on the key lift (~50/70/90%, not hard sets) → KEY/heaviest
  compound FIRST while fresh → other compounds → isolations last. NEVER open with an isolation or
  a light accessory.
- **Effort = meso-week RIR ramp.** Carry the meso week in `create_workout`'s recovery text (e.g.
  "70% (green) · Meso W2"); read yesterday's from `get_workout` dateInfo; +1 each Monday.
  W1: 3 RIR · W2: 2 RIR · W3: 1–2 RIR · W4: 0–1 RIR · W5: DELOAD (half the sets, ~60% load,
  nothing near failure) → reset to W1. The key lift's LAST set is always AMRAP at the week's RIR —
  that AMRAP is the progression/readiness signal.
- **NEVER fabricate a target weight.** If a lift has no logged history (check `get_exercise_progression` first), do NOT state a specific number — say "placeholder, confirm your working weight" or ask. Guessed targets erode trust (see CI_023).
- **Recovery modifier only:** green → push load/PRs; yellow → keep sets, cap intensity (RIR 1–2, hold
  load); red single day → keep sets, drop load; rest only if sleep <~5h / ≥2–3 red days / illness flag.
- Heavy compounds preserve muscle in a deficit. Min 48h between same muscle. Deload ~every 6 wks or if
  e1RM regresses across lifts while the multi-day recovery trend is down.

## Step 4 — Exercise preferences (honor these)
- **EVERY session starts with the 6-minute plank routine** (non-negotiable, lower-back health):
  1 min front / 1 min left side / 1 min right side, ×2 rounds, NO rest between. Put it at the
  top of every workout sheet as the warm-up. Matt skips core → his lower back hurts.
- **Incline DB press instead of floor flys** (he dislikes floor flys).
- Dumbbell-based when at home (working weights: bench ~45s, shoulder press ~25s).
- One key lift tracked per session — give a target number to chase.

## Step 5 — Build the sheet
- Tab `Workout_YYYY-MM-DD` in the canonical spreadsheet.
- Columns: Exercise | Set | Weight | Reps | Done. **Weight and Reps are PREFILLED with the
  targets** (the plan the experts crafted); Done is a checkbox per set.
- Targets must be REAL numbers from `get_exercise_progression` — never guessed. A lift with no
  history gets NO targetWeight (blank Weight; Matt establishes the baseline that day).
- Row 1 title (e.g., "CHEST — GYM (Recovery 78%)"), row 2 date + WHOOP context, then headers, then exercises.
- Use the `create_workout` tool; capture the returned sheet URL for the calendar block + message.

## Step 6 — Post-workout loop (read + edit the sheet)
- **Completion contract: a CHECKED Done box = Matt executed that set with the numbers shown.**
  He edits Weight/Reps only when he deviated from the plan. An unchecked set = not done.
  NEVER ask him to type numbers he already executed — the checkbox is his entire job.
  (Older sheets without checkboxes: filled Weight+Reps = completed.)
- When Matt says he's done (or the sheet shows checked boxes), use `get_workout` to read it, then
  call `ingest_workout` so his completed sets land in WORKOUT_DATABASE (deduped — safe any time).
- **RIR capture — ask exactly ONE number** after ingesting: "Last set of [key lift] — how many
  reps left in the tank?" Log it via `update_sheet_range` to that exercise's RIR cell in
  WORKOUT_DATABASE. Reps exactly equal to the prefilled target = UNVERIFIED effort (he stops at
  the number); only the AMRAP set + an answered RIR prove proximity to failure.
- **Baseline-conflict rule:** if a new baseline differs >20% from numbers Matt reported in chat,
  confirm with him before prefilling targets from it.
- If he reports numbers in chat, write them into the sheet yourself: `read_sheet` to find the right
  cells, then `update_sheet_range` to update Weight/Reps and set Done to TRUE for those sets.
- Note progression for next time and ask about ONE key lift, not a full debrief.

## Home-gym backup
If he likely missed the 5:30 gym, offer a 20-min home session matched to the split (HOME_GYM.md).
A 20-min home session on a green day beats a rest day.
