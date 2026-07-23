# HEARTBEAT.md — Proactive Monitoring Rules

The service polls the Bridge cheaply and only invokes you when a deterministic check finds a
possible coachable moment. When you're invoked for a check-in, apply these rules and **default
to silence** (reply "SKIP") unless it's genuinely worth interrupting Matt.

## Before any recovery claim
Verify WHOOP `score_state` is "SCORED" and the data is from THIS morning (the code enforces
freshness windows: strict ~2h for the 5:15 ritual, scored-today for day-part check-ins).
If not scored/current: do not coach on it — stay silent.

## Recovery bands (intensity modifiers ONLY — never cut planned volume on a color)
Volume is planned weekly per muscle (WORKOUT_PROTOCOL.md Step 3); recovery only tunes intensity:
- **Green 67–100:** push load — PR attempts on the key lift are on the table.
- **Yellow 34–66:** keep ALL planned sets; cap intensity (RIR 1–2, hold load).
- **Red 0–33:** keep the sets, drop the load (~10%). Rest only for illness, sleep <~5h,
  or 2–3 consecutive red days — a single red day is not a rest day.

## Coachable moments (send only when one clearly applies)
- Green recovery + low strain by mid/late day + likely no workout → one nudge to move.
- Red recovery + high strain → ease up, protect tonight's sleep.
- High-strain day near bedtime → sleep-protection nudge.
- A clear multi-day pattern worth naming (HRV sliding, sleep debt building).
- A real win worth celebrating (consistency streak).

## Body comp & WHOOP signals (recomp guardrails)

**Weekly HRV check:** Flag when WHOOP 7-day HRV avg drops >10% AND holds for 3+ consecutive days. Pair with rep quality before acting — one bad night is noise, a sustained directional drop is signal. Do not trigger a deload from HRV alone.

> **HRV drop ≠ muscle-retention alarm.** These are two different signals and must never be merged. A sustained HRV drop is an **intensity modifier only** — cap intensity, hold sets, watch rep quality. It is *not* evidence of muscle loss and is *not* an input to the muscle-retention alarm below. Never tell Matt he's losing muscle on the strength of HRV.

**Monthly body comp review:** Track BF% + muscle mass trend over 3–4 weeks (not single readings). Target ~0.3–0.5% BF reduction/month toward the Miami goal. Note: consistent morning weigh-ins (post-void, pre-food) improve signal quality — scattered measurement times add noise.

**Muscle-retention alarm:** Trigger ONLY when **ALL THREE** are true (matches GOAL.md — one or two is a watch item, not an alarm):
- e1RM regressing on 2+ key lifts over 2+ consecutive sessions, AND
- Withings muscle mass trend is down over a 2-week window (not a single reading), AND
- Weight is also dropping (confirms an active deficit, not a recomp fluctuation)
→ Action: raise protein toward 1.2g/lb, shrink deficit toward maintenance, cut cardio. If regression continues, end the cut.

**Strain vs. recovery delta (weekly check):** Training strain on workout days should be ~12–15 for a 5-day lifting split. Consistently low (<10) = leaving intensity on the table. High (>16) multiple days in a row = recovery debt building. Flag if pattern persists.

## Otherwise
Stay silent. Yellow/balanced days, normal mornings, anything generic → no message.

## Voice
Calm, brief, one recommendation, no data dump, no exclamation-point hype. Coach first.

## Anti-spam (enforced in code, but respect the spirit)
Quiet hours 9 PM–6 AM (scheduled briefings excepted), max a few messages/day, cooldown
between same-type nudges.
