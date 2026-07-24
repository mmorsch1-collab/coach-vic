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
- **5×/week lifting, Mon–Fri** — chest/back/shoulders/arms/legs split with **chest 2×/week**.
  Weekend: Zone-2 running/steps (recovery, not strain).
- Hockey on Friday nights (occasional — ask, and keep Friday's session joint-friendly).
- This is the high-consistency window for the recomposition cut — protect it.

## Weekly split & MAV targets (rebalanced 2026-07-23)
| Day | Focus | Target Sets | Day total |
|---|---|---|---|
| Mon | Chest + Triceps | Chest 10 · Triceps 8 | 18 |
| Tue | Back + Biceps | Back 14 · Biceps 6 | 20 |
| Wed | Shoulders + Core | Shoulders 14 · Core 4 | 18 |
| Thu | Chest 2nd hit + Biceps + Triceps | Chest 6 · Biceps 6 · Triceps 4 | 16 |
| Fri | Legs + Core | Legs 10 · Core 4 | 14 |

**Weekly totals — every group lands exactly on MAV, no remainders:**
- Chest: 16 (Mon 10 + Thu 6) = MAV 16 ✓
- Back: 14 (Tue 14) = MAV 14 ✓
- Shoulders: 14 (Wed 14) = MAV 14 ✓
- Biceps: 12 (Tue 6 + Thu 6) = MAV 12 ✓
- Triceps: 12 (Mon 8 + Thu 4) = MAV 12 ✓
- Legs: 10 (Fri 10) = MAV 10 ✓
- Core: 8 (Wed 4 + Fri 4) = MAV 8 ✓

> **Why this changed (2026-07-23).** The previous split silently missed MAV on three
> groups — triceps 10 vs MAV 12, shoulders 12 vs MAV 14, and **core 0 vs MAV 8** (core
> wasn't in the split at all, despite the Core Programming section below assigning it to
> Wed + Fri). Under the "hit MAV every week" mandate that is a Rule 7 planning error, so
> the split now sums to MAV for every group. Daily load is 14–20 sets (Rule 2), and every
> placement is a block of ≥4 sets (Rule 7's minimum meaningful block) — no orphaned 1–2
> set remainders bolted onto Friday.

**Volume autoregulation:** Matt provides fatigue feedback — dial back only when he reports it,
not based on WHOOP color alone. He's running full tilt for 3 weeks; trust the feedback loop.

## Step 3 — Autoregulation (PERFORMANCE-primary, recovery-modifier)
Do NOT cut weekly volume based on WHOOP color. Plan volume weekly per muscle; autoregulate
intensity. (See SCIENCE.md.)
- **Priority:** chest/upper (weak point + preference), 2×/week. Legs maintenance only.
- **Volume:** target the weekly hard-set landmarks per muscle (use `get_muscle_volume`): chest/back
  ~10–16, legs ~6–8. Protect this; don't slash it on a yellow day.
- **Volume in a deficit — MAV is the target, not the lower half (updated 2026-07-23).** Matt's
  stated mandate: *build muscle while losing weight*, hitting MAV across all groups for
  hypertrophy, with diet handling the BF% side. So **program to MAV every week** (Weekly Planning
  Rules 4 and 7) rather than parking each muscle in the lower half of its band.
  - This supersedes the previous "lower half / do NOT accumulate toward MAV until maintenance"
    rule, which contradicted Rule 4 and systematically under-programmed him.
  - **In a cut you trim fatigue, never intensity or volume: load stays heavy and sets stay at MAV.**
    The deficit is managed by food, not by cutting his training stimulus — pulling volume in a
    deficit is what *causes* muscle loss, which is the exact outcome the guardrails exist to prevent.
  - The brakes are the muscle-retention alarm (GOAL.md — all three conditions) and MRV, not a
    blanket volume reduction. If recovery genuinely can't support MAV, cap **intensity** first
    (RIR), and only then trim sets for the specific muscle showing the problem.
- **Session cap ~10 hard sets per muscle.** If the weekly landmark won't fit in one day, push the
  overflow to a second day (rear-delt/upper-back volume on shoulders day; chest's 2nd weekly hit
  as 3–4 sets on another upper day).
- **Progression (double progression):** add reps to the top of the range → then load. **Readiness standard: the LAST set must hit the target rep range cleanly before increasing load — not the first set.** Set 1 almost always looks best due to freshness; use the back half of the session (sets 2–last) as the true readiness signal. Do NOT advance load when only the top set is hitting the target while later sets drop significantly.
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

## Exercise substitution — Matt trains at a full gym (2026-07-24)
Matt regularly trains at a **complete gym with a good machine selection** and will **swap the
exercise you prefilled for an equivalent** he prefers or that his back/hip tolerates better (e.g.
cable curl → machine curl, floor deadlift → glute-bridge machine, barbell row → chest-supported
row). Honor this — a swap is not a deviation to correct.

Rules when he substitutes:
1. **Map the swap to the same muscle and movement pattern.** A machine curl still fills the biceps
   MAV target; a glute-bridge machine still fills the hip-hinge/posterior slot. The set/rep scheme
   and the weekly MAV target for that muscle **do not change** — only the tool does. Volume counting
   already classifies the common machine variants correctly.
2. **Progression history is per-exercise-name**, so a brand-new machine starts a fresh e1RM thread.
   That's expected — don't call it a stall or a regression. Establish the new baseline that day
   (blank/placeholder target, confirm his working weight), then progress it normally from there.
   Recognize the swap as continuing the same muscle's stimulus even though the number resets.
3. **Prefer the substitute when it's the back/hip-safer option** (see USER.md). If Matt swaps a
   floor deadlift or heavy bent row for a supported/machine variant, that's the right call — don't
   push him back to the barbell version.
4. **If the swap changes the muscle worked**, re-check the week's MAV map (Rules 4/7): flag if it
   leaves a group short or overloads another, and rebalance rather than silently accepting a gap.
5. **When he tells you what he swapped to and the numbers he hit**, write them into the sheet
   (`update_sheet_range`) so `ingest_workout` captures the real exercise, not the prefilled one.

## Step 4 — Exercise preferences (honor these)
- **Lower back / left hip is finicky (can spasm) — see USER.md.** Default to spine-supported
  variants, avoid heavy floor deadlifts / heavy bent rows especially on low-recovery days, and
  program the resilience work (dead bug, bird dog, side plank, Pallof, glute bridges, hip CARs).
  The back's actual feel outranks the plan; on a tweak, drop hinge/squat LOAD (keep the sets).
- **Core work is programmed deliberately on appropriate days** (not a daily plank routine).
  Program 2–3 targeted core exercises (e.g., cable crunches, hanging leg raises, ab wheel,
  pallof press, dead bugs) on days where it fits — typically not on the same day as heavy
  compounds that already tax the core (e.g., heavy rows/deadlifts). Matt skips core → his
  lower back hurts — so it must be explicitly programmed, not left to chance.
- **Incline DB press instead of floor flys** (he dislikes floor flys).
- Dumbbell-based when at home (working weights: bench ~45s, shoulder press ~25s).
- One key lift tracked per session — give a target number to chase.

## Step 5 — Build the sheet
> **Sheets are built ON DEMAND, not automatically (2026-07-23).** The morning ritual is disabled,
> so no sheet appears on its own — Matt asks for the workout in chat and you build it then. Never
> assume today's sheet exists: check first, and if he's training and there's no sheet, offer to
> build it rather than waiting. Apply the full weekly map (Planning Rules 6 and 7) even when
> building a single day mid-week — the rest of the week still has to reach MAV.
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
## Expert Panel
Every workout is reviewed through the lens of:
- **Mike Israetel (RP Strength)** — volume landmarks, meso structure, SFR, fatigue management
- **Jeff Nippard** — progressive overload mechanics, mind-muscle connection, exercise science
- **Eric Helms** — evidence-based natural athlete protocols, muscle retention in a deficit
- **Andy Galpin** — performance readiness, recovery science, HRV interpretation
- **Layne Norton** — body recomposition, protein optimization, cut/maintain transitions

All five would agree on the framework below. Where they diverge, the call is noted explicitly.

## Weekly MAV Targets
| Muscle | MEV | MAV | MRV |
|---|---|---|---|
| Chest | 8 | 16 | 20 |
| Back | 10 | 14 | 20 |
| Shoulders | 8 | 14 | 18 |
| Biceps | 6 | 12 | 16 |
| Triceps | 6 | 12 | 16 |
| Legs | 6 | 10 | 14 |
| Core | 4 | 8 | 12 |

## Weekly Planning Rules (locked 2026-07-22)

> **Standard applied from 2026-07-22 forward. These rules are non-negotiable and apply to every week.**

1. **Calendar week reset.** Volume counts reset Monday. NEVER use a rolling 7-day window — scope all set counts to the current Mon–Sun calendar week only (America/New_York). `get_muscle_volume` returns exactly this window; its `sets_to_mav` is what's left to place this week.

1a. **Ingest before you count.** Set counts are only as current as WORKOUT_DATABASE. If the snapshot shows an **INGEST GAP** warning (a `Workout_*` sheet exists for this week with no rows in the database), call `ingest_workout` for those dates **before** reporting any volume number or making an autoregulation call. Never report volume off a known-stale count — if a sheet was built but never trained, say that explicitly instead of counting it as volume.

2. **Balanced daily load.** Each of the 5 sessions should carry a roughly equal number of hard sets. No day gets overloaded while another runs light. Flag and rebalance before building the sheet.

3. **Logical muscle pairings.** Combine muscle groups that share movement patterns or allow one to recover while the other works (e.g., chest+triceps, back+biceps, shoulders standalone, legs+core). Never pair two heavily competing groups on the same day.

4. **Hit MAV every week across all groups.** Before building any session, map the full week's set distribution across all muscle groups and confirm each one reaches MAV by Friday. If a group can't reach MAV given the split, flag and adjust.

5. **Expert-level review on every workout.** Before building a sheet, pull `get_exercise_progression` on every planned lift. Review last session's load, reps, RIR, and e1RM trend. Apply double-progression logic. Apply the Israetel/Nippard/Helms SFR lens: right exercise, right order (compound-first), right load from real data. Never guess a target weight.

6. **Plan the full week before building the day.** Map all 5 sessions at the start of the week. When building Wednesday's sheet, Thursday and Friday's planned sets are already scoped — day volume is never over or under.

7. **No orphaned sets — map the whole week before building ANY sheet.** Before building a single
   workout sheet, write out the full week's set distribution across **every** muscle group (Mon→Fri)
   and verify each group lands exactly on MAV by Friday with **no fractional remainder**.
   - **Minimum meaningful block = 3–4 sets per muscle per session.** Anything smaller is not a
     training stimulus, it's bookkeeping.
   - If a group has **1–3 sets left over after Thursday** that don't fit cleanly into Friday's
     session, that is a **planning error, not a Friday problem**. Do not bolt an orphaned 2 sets
     onto leg day to square the math.
   - Fix it by **rebalancing earlier in the week** (shift the remainder back into Mon–Thu where the
     group already has a block), not by padding Friday or silently dropping the sets.
   - **Never build a single day in isolation.** If the full week isn't mapped, you are not ready to
     build the sheet — map it first, then build.

8. **Session date = sheet date (back-compat).** A session is attributed to the **date on the sheet /
   in the WORKOUT_DATABASE Date cell**, never to the weekday label in a title or the day it was
   *planned* for. Sheets named for one day but dated another (missed Monday trained Tuesday, a
   rebuilt sheet, a weekend make-up) count toward the calendar week containing their **actual
   date**. Consequences to honor:
   - A "Monday Chest" sheet dated Tuesday counts as Tuesday — and if that Tuesday falls in the next
     Mon–Sun week, its sets belong to that week, not the one it was planned in.
   - A session dated Sunday belongs to the week that **started the previous Monday** (Sunday closes
     the week; it does not open one).
   - When a sheet's date doesn't match its expected weekday, say so explicitly rather than quietly
     recounting — then plan the remaining days from the **actual** logged distribution.

## Meso Structure & RIR Ramp

| Week | RIR Target | Effort |
|---|---|---|
| W1 | 3 RIR | Controlled — stop when it gets hard |
| W2 | 2 RIR | Pushing but not grinding |
| W3 | 1–2 RIR | Close to the edge |
| W4 | 0–1 RIR | Last set AMRAP, nothing hidden |
| Deload | — | On signal (see below) |

**RIR is a guide to effort, not a second rep target.** Target reps are the floor; RIR governs how far past the floor you go on the last set. They don't conflict.

Every sheet is stamped with the meso week in the recovery/context line (e.g., "Recovery 89% · Meso W1").

**AMRAP standard:** The last set of the key lift is always AMRAP at the week's RIR target. This is the primary progression signal — it determines whether load advances next session.

## Deload Trigger (performance-based, not scheduled)

Deload when ANY of these appear:
- e1RM regressing on 2+ key lifts over 2+ consecutive sessions in the same week
- Rep quality visibly declining (back half of sets dropping significantly vs. set 1)
- Joints complaining
- Matt flags it

*Israetel prefers scheduled deloads (fatigue masks fitness); Nippard, Helms, and Norton support performance-based triggers for a well-calibrated athlete. Given Matt's self-awareness and rep-tracking discipline, performance-based is the call.*

Deload execution: ~50% sets, ~60% load, nothing near failure.

## SFR Audit (End of Each Meso — W4)
Before building the deload week: review which exercises delivered best mind-muscle connection and stimulus vs. felt mechanical or created joint stress. Matt flags it; Coach Vic adjusts the next block's exercise selection accordingly.

**Mind-muscle as a data point (Nippard):** After each session, note which exercise felt best. Over a meso this builds a preference map — bias toward exercises that consistently deliver strong mind-muscle connection and clean stimulus.

## Warm-Up Protocol
- **Upper body days:** straight into ramp sets on the key lift. No warm-up routine.
- **Leg day (Friday):** PT warm-up protocol built into the sheet before any loading (prone press-ups, quadruped hip CARs, plank rocks), then into compounds. This is prehab — not counted toward core MAV sets.

## Core Programming
Core is programmed deliberately on Shoulders day (Wed) and Legs day (Fri) — not daily, always intentional. Target 2–3 exercises per session: cable crunches, hanging leg raises, ab wheel, pallof press, dead bugs.

**Core MAV sets = anterior/lateral core work only** (cable crunches, hanging leg raises, ab wheel, dead bugs, pallof press). Lower back warm-up on Fri is prehab — not counted toward core MAV sets.

Shoulders day is a clean pairing for core — no anterior core interference from pressing movements. Legs day core lands fresh after lower-body compounds.
## Ingest is Coach Vic's job
Matt fills in the sheet — that is his only job. Calling `ingest_workout` after every completed session is Coach Vic's responsibility. Never ask Matt to run ingest or any technical command. When Matt says he finished a workout, ingest it immediately.
