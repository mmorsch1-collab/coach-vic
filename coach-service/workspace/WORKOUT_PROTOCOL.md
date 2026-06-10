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

## Step 2 — Pattern review (use the sheet for real history)
- Use `list_sheets` to find recent `Workout_*` tabs, then `get_workout` (or `read_sheet`) to pull
  the **actual weights/reps Matt logged** last time for the same lifts. Ground the "Last Time"
  column and progression targets in that real data — don't guess.
- Use `get_whoop_history` for multi-day recovery/strain context.
- Check muscle-group balance (have we hit chest 2x this week?) and weak/stalling lifts.

## Step 3 — Autoregulation (PERFORMANCE-primary, recovery-modifier)
Do NOT cut weekly volume based on WHOOP color. Plan volume weekly per muscle; autoregulate
intensity. (See SCIENCE.md.)
- **Priority:** chest/upper (weak point + preference), 2×/week. Legs maintenance only.
- **Volume:** target the weekly hard-set landmarks per muscle (use `get_muscle_volume`): chest/back
  ~10–16, legs ~6–8. Protect this; don't slash it on a yellow day.
- **Progression (double progression):** add reps to the top of the range → then load.
  - **At the GYM (barbell/rack/machines/cables — NO cap):** progress load normally once reps hit
    the top of the range. This is the default for heavy compounds; prefer the gym for lifts that
    have outgrown home weights.
  - **At HOME only (dumbbells cap at 45 lb):** when a lift hits the top of the range at 45 lb,
    escalate before declaring a stall: reps→~20 → tempo → ROM/stretch → pauses/1.5-reps →
    mechanical drop sets → density; at ~20 clean reps × 2 sessions, that lift has outgrown home —
    **route it to the gym** for real load progression.
- **Effort:** working sets ~1–2 RIR, last set of the key lift to failure. Log RIR via `log_set`.
- **NEVER fabricate a target weight.** If a lift has no logged history (check `get_exercise_progression` first), do NOT state a specific number — say "placeholder, confirm your working weight" or ask. Guessed targets erode trust (see CI_023).
- **Recovery modifier only:** green → push load/PRs; yellow → keep sets, cap intensity (RIR 1–2, hold
  load); red single day → keep sets, drop load; rest only if sleep <~5h / ≥2–3 red days / illness flag.
- Heavy compounds preserve muscle in a deficit. Min 48h between same muscle. Deload ~every 6 wks or if
  e1RM regresses across lifts while the multi-day recovery trend is down.

## Step 4 — Exercise preferences (honor these)
- **Incline DB press instead of floor flys** (he dislikes floor flys).
- Dumbbell-based when at home (working weights: bench ~45s, shoulder press ~25s).
- One key lift tracked per session — give a target number to chase.

## Step 5 — Build the sheet
- Tab `Workout_YYYY-MM-DD` in the canonical spreadsheet.
- Columns: Exercise | Set | Last Time | Target Weight | Target Reps | Actual Weight | Actual Reps | Notes.
- Row 1 title (e.g., "CHEST — GYM (Recovery 78%)"), row 2 date + WHOOP context, then headers, then exercises.
- Use the `create_workout` tool; capture the returned sheet URL for the calendar block + message.

## Step 6 — Post-workout loop (read + edit the sheet)
- When Matt says he's done / fills in the sheet, use `get_workout` (or `read_sheet`) to **read what
  he logged** in the Actual Weight/Reps columns.
- If he reports numbers in chat, write them into the sheet yourself: `read_sheet` to find the right
  cells, then `update_sheet_range` to fill the Actual columns / tweak targets / add a note.
- Note progression for next time and ask about ONE key lift, not a full debrief.

## Home-gym backup
If he likely missed the 5:30 gym, offer a 20-min home session matched to the split (HOME_GYM.md).
A 20-min home session on a green day beats a rest day.
