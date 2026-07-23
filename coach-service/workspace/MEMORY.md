# MEMORY.md — Long-Term Memory (main/private chat only)

Curated, durable memory. Daily logs are raw notes; this is the distilled essence. Update it
during curation and when something genuinely lasting happens.

## Who Matt is (essentials)
- 6'0", athletic/slim (~152 lbs, ~11.4% BF @ 2026-06-10 — live numbers come from the snapshot,
  never from this file). Chest is the priority muscle; legs already good.
- **Current goal: body recomposition to ~10% body fat** (preserve/build muscle). See GOAL.md.
- Works out 5:30 AM (gym); home-gym backup for missed sessions. Sleep is his #1 recovery lever.
- Eastern time. Wakes ~4:45, bed ~9 PM weekdays.

## How to coach Matt (what works — proven)
- **Coach first, data on request.** Lead with the action; explain the why only when asked.
  ("You executed your job perfectly" came when I led with the recommendation, not a data dump.)
- **Permission-based scheduling.** Recommend, then ask before blocking his calendar.
- **Contextual messaging only.** Always show you know today's context (workouts, meals, travel)
  before messaging. Generic advice breaks trust. High bar — silence over noise.
- **Clean messages.** No internal reasoning/calculations in what you send.
- **Casual tracking.** One key lift per workout; protein awareness via text, not macro logging.
- **Accountability via nutrition→body-comp.** He shares meals so you can connect food to results.
- **Incline DB press over floor flys.** Home working weights: bench ~45s, shoulder press ~25s.
- **Incline BARBELL bench (gym) baseline (2026-06-09): 95×11 warm-up, then 115×6/5/6 working sets
  (e1RM ~138).** The "185x8" numbers in the 06-09 chat were TEST data — never real (Matt confirmed
  2026-06-10). **Never state a specific target weight for a lift with no logged history — mark it
  "placeholder, confirm" or ask first** (see CI_023).

## Notes
- Historical RAG entries reference an old "vacation cut (April 22)" goal and a WHOOP VP-of-Product
  mission — both **retired**. The current goal is the 10% recomposition above; the persona is a
  calm health coach (not the old Tony-Robbins/executive voice).
## Protein tracking (deterministic — do NOT track from chat memory)
- Protein lives in NUTRITION_LOG via `log_meal` — log food the moment Matt mentions it (pass
  the eaten-date for previous days). The authoritative running total appears in the snapshot
  every turn. NEVER re-sum from conversation memory or keep a chat-side log.
- 165g/day is the non-negotiable muscle-retention lever. If the snapshot shows <120g by
  evening, flag it with one concrete fix; when he hits 165g+, acknowledge the win.

**Job transition upcoming:** Matt will soon be between jobs and has capacity to train hard Mon–Fri. This opens the door for higher volume, intensity, and consistency. Plan: 5×/week lifting (Mon–Fri chest/back/shoulders/arms/legs split with chest 2×/week), weekend running (Zone 2 recovery). Hockey plays Friday nights (occasional or regular — clarify). This is the optimal window for the recomposition cut (10% BF goal).

**Incline barbell bench:** first logged 95 lbs × 11 (2026-06-09) — see WORKOUT_DATABASE for current numbers/e1RM (computed, never copied here). Never fabricate targets — ground in real data or ask.

- (2026-06-10) Workout sheets prefill Weight/Reps with the plan's targets + a Done checkbox per
  set. Checked = executed as written; Matt edits numbers only when he deviated. His ONLY job is
  the checkbox — never ask for more. When he reports food from a previous day, log_meal with
  that date (it has a date param).

**Protein determinism (critical rule):** Matt's protein lives ONLY in NUTRITION_LOG (via log_meal, auto-dated). Never track from chat memory or ask him to re-sum. The snapshot's running daily total is authoritative. Log each meal/snack the moment he mentions it; the running total auto-accumulates and appears in my snapshot every turn. This is how gaps don't fall through cracks.

Protein-in-deficit strategy: 1.0–1.1g/lb (~165g @ 153 lb). Lever is lean protein sources (chicken, Greek yogurt, egg whites, shakes), not calorie counting. Hit 169g on 2026-06-19 with this template.

**2026-06-20 lock:** Matt commits to full MAV volume Mon–Fri (3-week push block, job-transition window). Split: Chest/Triceps, Back/Biceps, Shoulders, Chest 2nd/Biceps, Legs. Calendar at 9:30 AM. Feedback loop replaces WHOOP-based autoregulation.

Matt self-identifies readiness signals well (rep-drop pattern, back-half consistency) and asks to systematize them — engages critically in progression logic. Lead with clear readiness standards; he'll own them.

**Snapshot trust (critical):** When the snapshot shows a running daily total (e.g., protein 184g logged), READ that number first — it is authoritative and accumulated from all logged meals that day. Only if Matt claims a number differs from the snapshot should I ask for clarification. Never re-sum from chat-reported meals alone; that guarantees missing the earlier entries he didn't re-mention. (Lesson from 2026-07-10 protein confusion.)
