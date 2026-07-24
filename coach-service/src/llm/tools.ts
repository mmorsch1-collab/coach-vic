import type Anthropic from '@anthropic-ai/sdk';
import { bridge } from '../bridge/client.js';
import {
  appendDailyLog,
  appendMemoryMd,
  editBrainFile,
  EDITABLE_BRAIN_FILES,
  readDailyLog,
  searchDailyLogs,
} from '../memory/store.js';
import { invalidateSystemCache } from './systemPrompt.js';
import { appendEntry, DB_FILES, type DbFile } from '../memory/databases.js';
import { todayStr, calendarWeek } from '../util/time.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { e1rm, exerciseSeries, parseWorkoutDb, hardSetsInRange, sessionDatesInRange, slopePerWeek, progressionTarget, muscleOf, VOLUME_BANDS, bestE1rmBefore } from '../coaching/metrics.js';
import { invalidateSnapshot } from '../coaching/snapshot.js';
import { logMeal, PROTEIN_TARGET_G } from '../coaching/nutrition.js';
import { ingestWorkout, annotateCompletion } from '../coaching/workoutIngest.js';
import { classifyExercise } from '../coaching/exerciseClassification.js';
import { logFeedback } from '../coaching/feedback.js';

/**
 * Tools Coach Vic can call. Bridge tools = read/write health data; memory tools =
 * persist what was learned (write-back). Kept small and explicit.
 */

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_whoop_today',
    description:
      "Today's WHOOP recovery, sleep, and strain. ALWAYS check recovery.metadata.updated_at " +
      'freshness (within 2h) and score_state === "SCORED" before making coaching claims.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_withings_latest',
    description: 'Latest Withings body composition (weight, body fat %, muscle mass).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_withings_history',
    description: 'Recent Withings weight/body-comp history for trend analysis.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Days of history (default 7).' } },
    },
  },
  {
    name: 'get_strava_latest',
    description: 'Most recent Strava activity (type, distance, HR, pace).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_calendar_today',
    description: "Today's calendar events (for scheduling/availability context).",
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'create_calendar_event',
    description:
      'Create a calendar event (e.g., the 5:30 AM workout block). Times are local wall-clock ' +
      'in the user timezone; pass ISO-like "YYYY-MM-DDTHH:MM:SS" without a Z.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        startTime: { type: 'string', description: 'e.g. 2026-06-09T05:30:00' },
        endTime: { type: 'string', description: 'e.g. 2026-06-09T06:30:00' },
        description: { type: 'string' },
        location: { type: 'string' },
      },
      required: ['title', 'startTime', 'endTime'],
    },
  },
  {
    name: 'create_workout',
    description:
      'Create the daily workout sheet (tab Workout_YYYY-MM-DD in the canonical spreadsheet) and ' +
      'return its URL. The sheet PREFILLS Weight/Reps with your targets and adds a Done checkbox ' +
      'per set — Matt just ticks Done when he executes as written, so targets must be REAL ' +
      'numbers grounded in get_exercise_progression (never guessed). For a lift with no history, ' +
      'OMIT targetWeight (Weight stays blank for Matt to establish the baseline). ' +
      'IMPORTANT: the response returns `built_set_counts` and `week_projection` computed from the ' +
      'exercises you actually created. When you tell Matt the session\'s volume, report THOSE ' +
      'numbers verbatim — never a remembered plan. (Vic once said "10 leg sets" while building 13; ' +
      'the sheet is the source of truth, so reconcile against built_set_counts before speaking.)',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD of the workout.' },
        title: { type: 'string', description: 'e.g. "CHEST - GYM (Recovery 78%)".' },
        recovery: { type: 'string', description: 'Recovery context as text, e.g. "73% (green)".' },
        exercises: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              sets: { type: 'integer', description: 'Number of sets, 1-20.' },
              targetReps: { type: 'integer', description: 'Target reps per set (prefilled into Reps).' },
              targetWeight: {
                type: 'string',
                description:
                  'Target weight, e.g. "100" or "BW" — prefilled into Weight. OMIT when the lift has no logged history.',
              },
              notes: { type: 'string' },
            },
            required: ['name', 'sets'],
          },
        },
      },
      required: ['date', 'title', 'exercises'],
    },
  },
  {
    name: 'save_whoop_snapshot',
    description: 'Persist today\'s WHOOP numbers to the history sheet (for trend tracking).',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string' },
        recovery: { type: 'number' },
        hrv: { type: 'number' },
        restingHeartRate: { type: 'number' },
        sleepHours: { type: 'number' },
        sleepScore: { type: 'number' },
        strain: { type: 'number' },
      },
      required: ['date'],
    },
  },
  {
    name: 'get_goals',
    description: 'Read tracked goals from the sheet.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_workout',
    description:
      'Read a workout sheet for a given date (parsed). Each set has a `completed` flag: on current ' +
      'sheets Weight/Reps are PREFILLED with the plan and Matt ticks the Done checkbox (numbers as ' +
      'shown = what he did; he edits them only when he deviated). Never ask him to do more than ' +
      'tick the box. Use to review a session, discuss a key lift, or ground progressive overload.',
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD of the workout.' } },
      required: ['date'],
    },
  },
  {
    name: 'list_sheets',
    description:
      'List all tab names in the canonical coaching spreadsheet (e.g. to find recent Workout_* ' +
      'tabs for progression, or other tracking tabs).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'read_sheet',
    description:
      'Read raw rows from a tab in the canonical spreadsheet (optionally an A1 range). Use before ' +
      'editing so you know the exact row/column layout. For WORKOUT_DATABASE history/trends use ' +
      'get_exercise_progression / get_muscle_volume instead — do NOT dump the whole database.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Tab name, e.g. "Workout_2026-06-09".' },
        range: { type: 'string', description: 'Optional A1 range, e.g. "A1:H20".' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_sheet_range',
    description:
      'Write/overwrite cells in a tab at a specific A1 range — use to EDIT a workout (fill in ' +
      "Matt's actual weights/reps, tweak targets, add notes). Read the sheet first to target the " +
      'right cells. `data` is a 2D array matching the range shape.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Tab name, e.g. "Workout_2026-06-09".' },
        range: { type: 'string', description: 'A1 range to write, e.g. "F5:G5".' },
        data: {
          type: 'array',
          description: '2D array of cell values matching the range.',
          items: { type: 'array', items: {} },
        },
      },
      required: ['title', 'range', 'data'],
    },
  },
  {
    name: 'get_whoop_history',
    description: 'Recent WHOOP history (recovery/HRV/sleep/strain snapshots) for trend analysis.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Days of history (default 7).' } },
    },
  },
  {
    name: 'update_calendar_event',
    description:
      'Edit an existing calendar event (reschedule, retitle, change description/location). Get the ' +
      'event id from get_calendar_today. Times are local wall-clock "YYYY-MM-DDTHH:MM:SS".',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        startTime: { type: 'string' },
        endTime: { type: 'string' },
        description: { type: 'string' },
        location: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_calendar_event',
    description: 'Delete a calendar event by id (get the id from get_calendar_today).',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'log_set',
    description:
      "Log a completed exercise into WORKOUT_DATABASE (the canonical progression history). Call " +
      "this whenever Matt reports what he actually did, so history accumulates and e1RM/progression " +
      "compute correctly. e1RM is auto-computed. Include RIR (reps-in-reserve on the hardest set, " +
      "0=failure..4) when he gives it.",
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD (default today if omitted).' },
        session: { type: 'string', description: 'e.g. "Mon Chest".' },
        exercise: { type: 'string' },
        weight: { type: 'number', description: 'Working weight in lbs.' },
        set1: { type: 'number', description: 'Reps set 1.' },
        set2: { type: 'number', description: 'Reps set 2.' },
        set3: { type: 'number', description: 'Reps set 3.' },
        set4: { type: 'number', description: 'Reps set 4 (if done).' },
        set5: { type: 'number', description: 'Reps set 5 (if done).' },
        set6: { type: 'number', description: 'Reps set 6 (if done).' },
        rir: { type: 'number', description: 'Reps in reserve on the hardest set (0-4).' },
        notes: { type: 'string' },
      },
      required: ['exercise', 'weight'],
    },
  },
  {
    name: 'log_workout',
    description:
      'Log a COMPLETED workout (multiple lifts at once) to WORKOUT_DATABASE — the canonical source for ' +
      'volume + progression. Use when Matt reports a finished session. Volume and e1RM are computed ONLY ' +
      'from WORKOUT_DATABASE; the Workout_<date> sheet tabs are PLANS/targets — never count their numbers ' +
      'as completed volume.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD (default today).' },
        session: { type: 'string', description: 'e.g. "Chest Day".' },
        lifts: {
          type: 'array',
          description: 'Each completed exercise.',
          items: {
            type: 'object',
            properties: {
              exercise: { type: 'string' },
              weight: { type: 'number', description: 'Working weight in lbs.' },
              set1: { type: 'number' },
              set2: { type: 'number' },
              set3: { type: 'number' },
              set4: { type: 'number' },
              set5: { type: 'number' },
              set6: { type: 'number' },
              rir: { type: 'number', description: 'Reps in reserve, hardest set (0-4).' },
              notes: { type: 'string' },
            },
            required: ['exercise', 'weight'],
          },
        },
      },
      required: ['lifts'],
    },
  },
  {
    name: 'ingest_workout',
    description:
      "Read Matt's filled-in Workout_<date> sheet and import his ACTUAL completed sets into " +
      'WORKOUT_DATABASE (deduped). Call this when he says he finished/completed his workout.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD (default today if omitted).' },
      },
    },
  },
  {
    name: 'log_meal',
    description:
      "Log a meal/snack's protein the MOMENT Matt mentions food. Appends to the deterministic daily " +
      'nutrition log; the running daily total appears in your snapshot every turn, so you never re-sum ' +
      'from memory or forget an earlier meal. Estimate protein in grams (use the midpoint of a range). ' +
      'IMPORTANT: `date` is the day the food was EATEN — if Matt reports food from a previous day ' +
      '("yesterday I had…", "last night…"), pass that date so it does NOT count toward today.',
    input_schema: {
      type: 'object',
      properties: {
        protein_g: { type: 'number', description: 'Estimated protein in grams.' },
        food: { type: 'string', description: 'What he ate.' },
        meal: { type: 'string', description: 'breakfast | lunch | dinner | snack (optional).' },
        date: { type: 'string', description: 'YYYY-MM-DD the food was eaten. Default today; REQUIRED when he reports a previous day.' },
      },
      required: ['protein_g', 'food'],
    },
  },
  {
    name: 'get_exercise_progression',
    description:
      'Full progression history for one lift from WORKOUT_DATABASE: per-session top set, e1RM, ' +
      'and the e1RM trend (est. 1RM change/week). Use to ground "last time" + set the next target.',
    input_schema: {
      type: 'object',
      properties: {
        exercise: { type: 'string' },
        limit: { type: 'number', description: 'How many recent sessions (default 10).' },
      },
      required: ['exercise'],
    },
  },
  {
    name: 'get_muscle_volume',
    description:
      'Hard-set count per muscle group for the CURRENT Mon–Sun calendar week (America/New_York, ' +
      'resets every Monday — NOT a rolling 7-day window) vs evidence-based landmarks ' +
      '(MEV/MAV/MRV), plus sets_to_mav remaining. Use to balance the split, map the rest of the ' +
      'week, and avoid under/over-training. Counts are stale if a workout sheet for this week ' +
      'has not been ingested — check the snapshot ingest warning and call ingest_workout first.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'log_workout_feedback',
    description:
      'Record post-workout subjective feedback for ONE exercise, so it drives coaching. Capture ' +
      'during the feel/effort debrief — one light pass over the session\'s main lifts. Every field ' +
      'is optional except exercise; log what Matt gives, don\'t interrogate. Each signal is used: ' +
      '• rir (key lift, last set) gates whether load advances next session. ' +
      '• mmc (mind-muscle connection) drives exercise SELECTION — and you MUST capture WEAK/NONE ' +
      'too, not just good ones: an exercise Matt feels nothing in over 2+ sessions gets flagged to ' +
      'replace. Always ask how the connection felt, including "did anything feel like it did nothing?" ' +
      '• pain (area + severity) drives substitution and load backoff, especially the finicky lower ' +
      'back / left hip (see USER.md) — log any tweak even if mild. Re-calling for the same ' +
      'exercise+date merges (updates), so it\'s safe to add fields as Matt mentions them.',
    input_schema: {
      type: 'object',
      properties: {
        exercise: { type: 'string', description: 'Exact exercise name as logged.' },
        date: { type: 'string', description: 'YYYY-MM-DD; defaults to today.' },
        rir: { type: 'number', description: 'Reps in reserve on the last/hardest set (0–4).' },
        mmc: {
          type: 'string',
          enum: ['strong', 'moderate', 'weak', 'none'],
          description: 'Mind-muscle connection. "none"/"weak" = felt little/nothing in the target muscle → replacement candidate.',
        },
        pain_area: { type: 'string', description: 'Body area that felt off, e.g. "lower back", "left hip", "left knee". Omit if none.' },
        pain_severity: { type: 'string', enum: ['mild', 'moderate', 'sharp'], description: 'How bad the tweak felt.' },
        note: { type: 'string', description: 'Any short qualitative detail worth keeping.' },
      },
      required: ['exercise'],
    },
  },
  {
    name: 'classify_exercise',
    description:
      'Record which muscle group an exercise trains, so its sets count toward weekly volume. ' +
      'Use this whenever the snapshot flags an UNCLASSIFIED EXERCISE, or whenever Matt swaps in / ' +
      'mentions a lift Vic has not classified — ASK him which muscle it primarily works (offer ' +
      'your best guess), then record his answer here. This is authoritative: it overrides the ' +
      'automatic classifier and persists, so a novel or mis-mapped exercise is fixed once and ' +
      'stays fixed. Do NOT leave a swapped/novel exercise unclassified — its volume is invisible ' +
      'until you do. Fold the question into any "how did it feel / effort / joints" debrief.',
    input_schema: {
      type: 'object',
      properties: {
        exercise: { type: 'string', description: 'Exact exercise name as it appears in the sheet/log.' },
        muscle: {
          type: 'string',
          enum: ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'legs', 'core', 'warmup'],
          description: 'Primary muscle group. Use "warmup" for prehab/mobility/ramp work that should not count as volume.',
        },
      },
      required: ['exercise', 'muscle'],
    },
  },
  {
    name: 'get_bodycomp_trend',
    description:
      'Body-composition trend from BODY_COMPOSITION: recent weight/BF% and the weight slope ' +
      '(lb/week) for managing the cut/maintenance rate.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Window in days (default 21).' } },
    },
  },
  {
    name: 'remember',
    description:
      'Write-back a durable memory so future coaching is grounded. Choose the right database. ' +
      'Use for new context about Matt, a preference, a coaching insight (what worked/failed), ' +
      'or a performance pattern.',
    input_schema: {
      type: 'object',
      properties: {
        database: {
          type: 'string',
          enum: DB_FILES as unknown as string[],
          description: 'Which RAG database to append to.',
        },
        title: { type: 'string', description: 'Short entry header, e.g. "ctx_019 — meal timing".' },
        body: { type: 'string', description: 'The entry content (markdown).' },
      },
      required: ['database', 'title', 'body'],
    },
  },
  {
    name: 'log_today',
    description: 'Append a short raw note to today\'s daily log (memory/YYYY-MM-DD.md).',
    input_schema: {
      type: 'object',
      properties: { note: { type: 'string' } },
      required: ['note'],
    },
  },
  {
    name: 'recall_day',
    description:
      "Read the raw daily log for a specific past date (conversations, meals, workouts, decisions " +
      "from that day). Use when Matt references a specific day ('last Tuesday', 'two days ago') or " +
      'you need exactly what was said/decided on a date. For date-unknown questions use search_memory.',
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD of the day to recall.' } },
      required: ['date'],
    },
  },
  {
    name: 'search_memory',
    description:
      'Search ALL past daily logs (up to ~60 days) for lines matching a few keywords. Use when ' +
      "Matt asks about something from the past and you don't know the date ('what did I say about " +
      "my elbow?', 'when did we change the deload rule?'). Returns matching lines with dates — " +
      'follow up with recall_day for full context.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '2-4 specific keywords (e.g. "elbow", "deload barbell").' },
      },
      required: ['query'],
    },
  },
  {
    name: 'update_coaching_rule',
    description:
      'Durably change your OWN coaching behavior by editing one of your brain files (rules, ' +
      'preferences, goal, persona, science). Takes effect IMMEDIATELY (hot-reload, no restart). ' +
      'Use when Matt asks you to change how you coach, add/change a rule, or update a preference or ' +
      'goal. Prefer `append` for a new rule; use `find`/`replace` to change existing text. ' +
      'You CANNOT edit code/logic/tools this way — for those, tell Matt it needs Claude Code. ' +
      'Always tell Matt exactly what you changed.',
    input_schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          enum: Array.from(EDITABLE_BRAIN_FILES) as unknown as string[],
          description: 'Which brain file to edit (e.g. WORKOUT_PROTOCOL.md for training rules, GOAL.md, MEMORY.md).',
        },
        append: { type: 'string', description: 'Text to add at the end (a new rule/line/section).' },
        find: { type: 'string', description: 'Exact existing text to replace (optional).' },
        replace: { type: 'string', description: 'Replacement for `find` (omit to delete it).' },
      },
      required: ['file'],
    },
  },
  {
    name: 'update_long_term_memory',
    description:
      'Append a distilled, durable fact to MEMORY.md (curated long-term memory). Main/private ' +
      'chat only. Use sparingly for things worth remembering for months.',
    input_schema: {
      type: 'object',
      properties: { line: { type: 'string' } },
      required: ['line'],
    },
  },
];

export interface ToolContext {
  sessionType: 'main' | 'isolated';
}

/** Execute a tool call and return a string result for the model. */
export async function executeTool(
  name: string,
  input: any,
  ctx: ToolContext,
): Promise<string> {
  try {
    switch (name) {
      case 'get_whoop_today':
        return json(await bridge.whoopToday());
      case 'get_withings_latest':
        // Flat summary (weight + body comp merged) — better for the LLM than raw /latest.
        return json(await bridge.withingsSummary());
      case 'get_withings_history':
        return json(await bridge.withingsHistory(clampDays(input?.days, 7)));
      case 'get_strava_latest':
        return json(await bridge.stravaLatest());
      case 'get_calendar_today':
        return json(await bridge.calendarToday());
      case 'create_calendar_event':
        return json(
          await bridge.createCalendarEvent({
            title: input.title,
            startTime: input.startTime,
            endTime: input.endTime,
            description: input.description,
            location: input.location,
            timeZone: config.tz,
          }),
        );
      case 'create_workout': {
        const exs = (input.exercises ?? []) as Array<{ name?: string; sets?: number }>;
        const result = await bridge.createWorkout({
          date: input.date,
          title: input.title,
          // Bridge expects recovery as a string; coerce defensively.
          recovery: input.recovery != null ? String(input.recovery) : undefined,
          exercises: input.exercises ?? [],
        });
        // Compute the ACTUAL per-muscle set count of the sheet just built, so the
        // numbers reported to Matt match what was created. Vic once said "10 leg
        // sets" while building 13 — this makes that impossible: report THESE.
        const built: Record<string, number> = {};
        for (const e of exs) {
          const mus = muscleOf(String(e.name ?? ''));
          if (mus === 'warmup') continue;
          built[mus] = (built[mus] || 0) + (Number(e.sets) || 0);
        }
        // Project the week: what's already logged + what this sheet adds.
        let weekNow: Record<string, number> = {};
        try {
          const logs = parseWorkoutDb((await bridge.readSheet('WORKOUT_DATABASE')) as unknown[][]);
          const wk = calendarWeek(config.tz);
          weekNow = hardSetsInRange(logs, wk.start, wk.end);
        } catch { /* projection is best-effort */ }
        const projection = Object.keys(VOLUME_BANDS).map((mu) => {
          const add = built[mu] || 0;
          const proj = (weekNow[mu] || 0) + add;
          const b = VOLUME_BANDS[mu];
          const status =
            proj > b.mrv ? 'OVER_MRV' : proj > b.mav ? `over_MAV_by_${proj - b.mav}` : proj === b.mav ? 'at_MAV' : `${b.mav - proj}_to_MAV`;
          return { muscle: mu, this_sheet: add, week_after: proj, mav: b.mav, mrv: b.mrv, status };
        });
        // PLANNING DISCIPLINE CHECK. The intent is to hit each muscle's MAV — no
        // more, no less. Building a muscle PAST its MAV while another is still
        // short is undisciplined drift (on 2026-07-24 legs were built to 13 vs a
        // MAV of 10 while back/shoulders were short). Flag it so the plan is
        // reconciled to intent BEFORE the sheet is presented, not after.
        // Only flag overshoot for muscles THIS sheet contributes to — a leg day
        // shouldn't nag about chest already being over from earlier in the week.
        const overshoot = projection.filter((p) => p.this_sheet > 0 && p.week_after > p.mav);
        const short = projection.filter((p) => p.week_after < p.mav);
        const planningWarnings: string[] = [];
        for (const o of overshoot) {
          planningWarnings.push(
            `${o.muscle} built to ${o.week_after} vs MAV ${o.mav} (+${o.week_after - o.mav} over). ` +
              `Was that deliberate? If not, trim to ${o.mav}.`,
          );
        }
        if (overshoot.length && short.length) {
          planningWarnings.push(
            `IMBALANCE: overshooting [${overshoot.map((o) => o.muscle).join(', ')}] while [${short
              .map((s) => `${s.muscle} (+${s.mav - s.week_after} short)`)
              .join(', ')}] miss MAV. Rebalance before presenting.`,
          );
        }
        return json({
          ...result,
          built_set_counts: built,
          week_projection: projection,
          planning_warnings: planningWarnings.length ? planningWarnings : undefined,
          report_rule:
            'Report built_set_counts to Matt, NOT a remembered plan. If planning_warnings is present, ' +
            'the built sheet DRIFTED from the MAV target — reconcile the sheet (or state the deliberate ' +
            'reason for the overshoot) BEFORE presenting it. The plan must equal the intent.',
        });
      }
      case 'save_whoop_snapshot':
        return json(await bridge.whoopSnapshot(input));
      case 'get_goals':
        return json(await bridge.getGoals());
      case 'get_workout':
        // Per-set `completed` under the sheet's contract (Done checkbox on current
        // sheets; filled Weight+Reps on legacy ones) — raw `done` is stripped.
        return json(annotateCompletion(await bridge.getWorkout(input.date)));
      case 'list_sheets':
        return json(await bridge.listSheets());
      case 'read_sheet': {
        const rows = (await bridge.readSheet(input.title, input.range)) as unknown[][];
        // Unbounded raw dumps (esp. WORKOUT_DATABASE) grow forever and are re-billed
        // every loop iteration. With no explicit range, cap to header + last 50 rows.
        if (!input.range && Array.isArray(rows) && rows.length > 60) {
          return json({
            note: `Truncated: showing header + last 50 of ${rows.length} rows. Pass a range for more, or use get_exercise_progression / get_muscle_volume for history.`,
            rows: [rows[0], ...rows.slice(-50)],
          });
        }
        return json(rows);
      }
      case 'update_sheet_range':
        return json(await bridge.updateSheetRange(input.title, input.range, input.data ?? []));
      case 'get_whoop_history':
        return json(await bridge.whoopHistory(clampDays(input?.days, 7)));
      case 'update_calendar_event':
        return json(
          await bridge.updateCalendarEvent(input.id, {
            title: input.title,
            startTime: input.startTime,
            endTime: input.endTime,
            description: input.description,
            location: input.location,
            timeZone: config.tz,
          }),
        );
      case 'delete_calendar_event':
        return json(await bridge.deleteCalendarEvent(input.id));
      case 'log_set': {
        const date = input.date || todayStr(config.tz);
        const reps = [input.set1, input.set2, input.set3, input.set4, input.set5, input.set6]
          .map((n: any) => Number(n))
          .filter((n) => Number.isFinite(n) && n > 0);
        const topReps = reps.length ? Math.max(...reps) : 0;
        const est = Math.round(e1rm(Number(input.weight) || 0, topReps) * 10) / 10;
        const prNote = await prCheckBefore(input.exercise, date, est);
        await bridge.appendSheet('WORKOUT_DATABASE', [[
          date,
          input.session ?? '',
          input.exercise,
          Number(input.weight) || '',
          input.set1 ?? '',
          input.set2 ?? '',
          input.set3 ?? '',
          input.notes ?? '',
          input.rir ?? '',
          est || '',
          input.set4 ?? '',
          input.set5 ?? '',
          input.set6 ?? '',
        ]]);
        invalidateSnapshot();
        return ok(`Logged ${input.exercise} ${input.weight}lb ${reps.join('/')} (e1RM ${est}) to WORKOUT_DATABASE.${prNote}`);
      }
      case 'log_workout': {
        const date = input.date || todayStr(config.tz);
        const lifts = Array.isArray(input.lifts) ? input.lifts : [];
        if (!lifts.length) return ok('No lifts provided.');
        const prNotes: string[] = [];
        const rows = [];
        for (const l of lifts) {
          const reps = [l.set1, l.set2, l.set3, l.set4, l.set5, l.set6]
            .map((n: any) => Number(n))
            .filter((n: number) => Number.isFinite(n) && n > 0);
          const top = reps.length ? Math.max(...reps) : 0;
          const est = Math.round(e1rm(Number(l.weight) || 0, top) * 10) / 10;
          const pr = await prCheckBefore(l.exercise, date, est);
          if (pr) prNotes.push(pr.trim());
          rows.push([date, input.session ?? '', l.exercise, Number(l.weight) || '', l.set1 ?? '', l.set2 ?? '', l.set3 ?? '', l.notes ?? '', l.rir ?? '', est || '', l.set4 ?? '', l.set5 ?? '', l.set6 ?? '']);
        }
        await bridge.appendSheet('WORKOUT_DATABASE', rows);
        invalidateSnapshot();
        return ok(
          `Logged ${rows.length} lift(s) to WORKOUT_DATABASE for ${date}: ${lifts.map((l: any) => l.exercise).join(', ')}.` +
            (prNotes.length ? ` ${prNotes.join(' ')}` : ''),
        );
      }
      case 'ingest_workout': {
        const res = await ingestWorkout(input?.date);
        const prMsg = res.prs.length ? ` 🎉 PR: ${res.prs.join('; ')} — celebrate this with Matt!` : '';
        return ok(
          res.added > 0
            ? `Imported ${res.added} exercise(s) into WORKOUT_DATABASE: ${res.exercises.join(', ')}${res.skipped ? ` (skipped ${res.skipped} already-logged)` : ''}.${prMsg}`
            : `No new actuals to import${res.skipped ? ` (${res.skipped} already logged)` : ' (no filled sets found)'}.`,
        );
      }
      case 'log_meal': {
        const grams = Number(input.protein_g) || 0;
        const r = await logMeal({ proteinG: grams, food: input.food ?? '', meal: input.meal, date: input.date });
        invalidateSnapshot();
        const today = todayStr(config.tz);
        return ok(
          r.date === today
            ? `Logged ${input.food} (${Math.round(grams)}g protein). Today: ${Math.round(r.totalG)}g / ${PROTEIN_TARGET_G}g — ${r.remainingG}g to go.`
            : `Logged ${input.food} (${Math.round(grams)}g protein) to ${r.date}. That day's total: ${Math.round(r.totalG)}g / ${PROTEIN_TARGET_G}g. (Does NOT count toward today.)`,
        );
      }
      case 'get_exercise_progression': {
        const rows = await bridge.readSheet('WORKOUT_DATABASE');
        const logs = parseWorkoutDb(rows as unknown[][]);
        const series = exerciseSeries(logs, input.exercise);
        const limited = series.slice(-(input.limit ?? 10));
        const slope = slopePerWeek(series.slice(-6).map((p) => ({ date: p.date, y: p.topE1rm })));
        const target = progressionTarget(series);
        return json({
          exercise: input.exercise,
          sessions: limited,
          e1rm_slope_per_week: Math.round(slope * 10) / 10,
          // Grounded prefill: use suggested_weight, NOT the last row's weight.
          // Prevents prescribing a one-off load jump (e.g. Hammer Curl 30 after a
          // history of 15) and guarantees a number when history exists.
          target: target
            ? {
                suggested_weight: target.suggestedWeight,
                established_weight: target.establishedWeight,
                last_weight: target.lastWeight,
                verified: target.verified,
                guidance: target.note,
              }
            : { guidance: 'No history — establish a baseline this session; do NOT prefill a guessed weight.' },
        });
      }
      case 'get_muscle_volume': {
        const rows = await bridge.readSheet('WORKOUT_DATABASE');
        const logs = parseWorkoutDb(rows as unknown[][]);
        // STRICT Mon–Sun calendar week (protocol rule 1), NOT a rolling 7 days:
        // a rolling window drags last week's Fri/Sat sets into Monday's count.
        const week = calendarWeek(config.tz);
        const hs = hardSetsInRange(logs, week.start, week.end);
        const muscles = Object.keys(VOLUME_BANDS).map((m) => {
          const n = hs[m] || 0;
          const b = VOLUME_BANDS[m];
          return {
            muscle: m,
            hard_sets_this_week: n,
            ...b,
            sets_to_mav: Math.max(0, b.mav - n),
            status: n < b.mev ? 'under' : n > b.mrv ? 'over' : 'in_range',
          };
        });
        return json({
          week_start_monday: week.start,
          week_end_sunday: week.end,
          timezone: config.tz,
          sessions_logged: sessionDatesInRange(logs, week.start, week.end),
          note:
            'Counts are for the CURRENT Mon–Sun calendar week only and reset each Monday. ' +
            'Sessions are attributed by their logged DATE, not a weekday label. If a workout ' +
            'sheet for this week has not been ingested yet these counts are stale — check the ' +
            'snapshot ingest warning and call ingest_workout first.',
          muscles,
        });
      }
      case 'log_workout_feedback': {
        const saved = await logFeedback({
          exercise: input.exercise,
          date: input.date,
          rir: input.rir,
          mmc: input.mmc,
          painArea: input.pain_area,
          painSeverity: input.pain_severity,
          note: input.note,
        });
        if (!saved) return ok('Could not log feedback — an exercise name is required.');
        invalidateSnapshot();
        const bits = [
          saved.rir != null ? `RIR ${saved.rir}` : null,
          saved.mmc ? `MMC ${saved.mmc}` : null,
          saved.painArea ? `pain: ${saved.painArea}${saved.painSeverity ? ` (${saved.painSeverity})` : ''}` : null,
        ].filter(Boolean);
        return ok(`Logged feedback for ${saved.exercise}${bits.length ? ` — ${bits.join(', ')}` : ''}.`);
      }
      case 'classify_exercise': {
        const saved = await classifyExercise(input.exercise, input.muscle);
        if (!saved) {
          return ok(
            `Could not classify "${input.exercise}" as "${input.muscle}" — muscle must be one of ` +
              `chest, back, shoulders, biceps, triceps, legs, core, warmup.`,
          );
        }
        return ok(
          `Got it — "${input.exercise}" now counts as ${saved}. This is saved and will apply to ` +
            `all past and future logs of that exercise.`,
        );
      }
      case 'get_bodycomp_trend': {
        const rows = (await bridge.readSheet('BODY_COMPOSITION')) as unknown[][];
        const days = clampDays(input?.days, 21);
        const header = (rows[0] || []).map((h) => String(h ?? '').trim().toLowerCase());
        const di = header.findIndex((h) => h.includes('date'));
        const wi = header.findIndex((h) => h.includes('weight'));
        // Body-fat %, not "fat free mass" / "visceral fat": require body+fat or fat+%.
        let fi = header.findIndex((h) => h.includes('body') && h.includes('fat'));
        if (fi < 0) fi = header.findIndex((h) => h.includes('fat') && h.includes('%'));
        const pts: Array<{ date: string; weight: number; bf: number }> = [];
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r] || [];
          const d = String(row[di] ?? '').trim();
          const w = Number(row[wi]);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(w)) continue;
          pts.push({ date: d, weight: w, bf: Number(row[fi]) });
        }
        pts.sort((a, b) => a.date.localeCompare(b.date));
        const cutoff = Date.now() - days * 86400000;
        const windowed = pts.filter((p) => Date.parse(p.date + 'T12:00:00') >= cutoff);
        const slope = slopePerWeek((windowed.length ? windowed : pts).map((p) => ({ date: p.date, y: p.weight })));
        return json({
          recent: pts.slice(-8),
          weight_slope_lb_per_week: Math.round(slope * 100) / 100,
          latest: pts[pts.length - 1] ?? null,
        });
      }
      case 'remember':
        await appendEntry(input.database as DbFile, input.title, input.body);
        return ok(`Saved to ${input.database}.`);
      case 'log_today':
        await appendDailyLog(todayStr(config.tz), input.note);
        return ok('Logged.');
      case 'recall_day': {
        const d = String(input.date ?? '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return ok('Pass date as YYYY-MM-DD.');
        const log = await readDailyLog(d);
        if (!log.trim()) return ok(`No daily log exists for ${d}.`);
        // Tail-cap: a chatty day's full transcript can be thousands of tokens.
        const capped = log.length > 8000 ? `(…earlier truncated)\n${log.slice(-8000)}` : log;
        return json({ date: d, log: capped });
      }
      case 'search_memory': {
        const hits = await searchDailyLogs(String(input.query ?? ''));
        return hits
          ? json({ matches: hits })
          : ok('No matching lines in the daily logs (try fewer/different keywords).');
      }
      case 'update_coaching_rule': {
        if (ctx.sessionType !== 'main') return ok('Rule edits are only allowed in private chat.');
        const res = await editBrainFile(input.file, {
          append: input.append,
          find: input.find,
          replace: input.replace,
        });
        if (res.ok) {
          invalidateSystemCache(); // hot-reload the brain on the next turn
          invalidateSnapshot();
          await appendDailyLog(
            todayStr(config.tz),
            `[rule-change] ${input.file}: ${input.append ?? `${input.find} → ${input.replace ?? '(deleted)'}`}`,
          );
        }
        return json(res);
      }
      case 'update_long_term_memory':
        if (ctx.sessionType !== 'main') return ok('Skipped: long-term memory is main-session only.');
        await appendMemoryMd(input.line);
        return ok('MEMORY.md updated.');
      default:
        return ok(`Unknown tool: ${name}`);
    }
  } catch (err: any) {
    logger.warn({ err, tool: name }, 'Tool execution failed');
    // Return the error to the model so it can degrade gracefully instead of crashing.
    return json({ error: true, message: err?.message ?? String(err), code: err?.code });
  }
}

function json(v: unknown): string {
  return JSON.stringify(v ?? null);
}
function ok(message: string): string {
  return JSON.stringify({ ok: true, message });
}
/** Clamp an untrusted model-supplied `days` param (NaN-safe) to 1..31. */
function clampDays(v: unknown, dflt: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(31, Math.max(1, Math.round(n)));
}

/**
 * PR check at log time: compare a just-computed e1RM to the exercise's best
 * BEFORE `date`. Returns a celebration suffix for the tool result ('' if not a
 * PR / no prior history) and drops a [pr] line into the daily log so briefings
 * and later turns can reference it. Never throws.
 */
async function prCheckBefore(exercise: string, date: string, est: number): Promise<string> {
  try {
    if (!exercise || !est) return '';
    const rows = (await bridge.readSheet('WORKOUT_DATABASE')) as unknown[][];
    const prior = bestE1rmBefore(parseWorkoutDb(rows), exercise, date);
    if (prior > 0 && est > prior) {
      await appendDailyLog(todayStr(config.tz), `[pr] New e1RM PR — ${exercise}: ${est} (prev best ${prior})`).catch(() => undefined);
      return ` 🎉 NEW e1RM PR on ${exercise}: ${est} (prev best ${prior}) — celebrate this with Matt!`;
    }
    return '';
  } catch {
    return '';
  }
}
