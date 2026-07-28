import cron, { type ScheduledTask } from 'node-cron';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { JsonStore } from '../state/jsonStore.js';
import { todayStr } from '../util/time.js';
import { tryReserveProactive, wouldAllowProactive } from './proactiveState.js';
import { appendDailyLog } from '../memory/store.js';
import { mainSession } from '../session/session.js';
import { runMorningRitual } from './morningRitual.js';
import { runMidMorningCheck, runAfternoonCheck, runEveningCheck, runMissedWorkoutCheck, type CheckinResult } from './checkins.js';
import { runDailyCuration } from '../memory/curation.js';
import { runSelfHeal } from './selfHeal.js';
import { runMaintenanceReport } from './maintenance.js';
import { runWeeklyReview } from './weeklyReview.js';
import { syncBodyComp } from './bodyCompSync.js';
import { syncWhoopSnapshot } from './whoopSync.js';
import { runDailyClose } from './dailyClose.js';
import { ingestWorkout } from '../coaching/workoutIngest.js';
import { runCostReport } from './costReport.js';

/**
 * Registers all scheduled jobs (the ported OpenClaw cron set). Each job decides
 * silently (LLM-free where possible); only sends through the gate + delivery queue.
 */

export interface JobDeps {
  deliver: (text: string) => Promise<void>;
}

const ritualState = new JsonStore<{
  lastBriefingDay: string;
  // Compose-once: the 7:00 fallback re-delivers a stored briefing instead of
  // re-running the full Sonnet composition (and its side-effect tools).
  composedDay?: string;
  composedMessage?: string;
}>('ritual-state.json', {
  lastBriefingDay: '',
});

// One-shot: a few days after chat moved to Sonnet, send a real cost check-in.
const COST_REPORT_AFTER = '2026-06-14';
const costReportState = new JsonStore<{ sent: boolean }>('cost-report-state.json', { sent: false });

const tzOpt = { timezone: config.tz } as const;

/** Returns true if the message was actually reserved + delivered. */
async function emit(type: string, message: string, deps: JobDeps, opts = {}): Promise<boolean> {
  const gate = await tryReserveProactive(type, opts);
  if (!gate.allowed) {
    logger.info({ type, reason: gate.reason }, 'Proactive message suppressed by gate');
    return false;
  }
  await deps.deliver(message);
  await appendDailyLog(todayStr(config.tz), `[proactive:${type}] ${message}`);
  // Thread the proactive message into the chat history: Matt's reply to a nudge
  // should land with the nudge (and its question) in conversational context.
  try {
    await mainSession.appendAssistant(message);
  } catch (err) {
    logger.warn({ err, type }, 'Could not append proactive message to session history');
  }
  return true;
}

// In-process guard so a slow 5:15 run can't overlap with the 7:00 fallback (or a
// duplicate fire) and produce two briefings / two workout sheets in one day.
let morningRunning = false;

async function morningRitualJob(deps: JobDeps, isFallback = false): Promise<void> {
  const today = todayStr(config.tz);
  const st = await ritualState.read();
  if (st.lastBriefingDay === today) {
    logger.info({ isFallback }, 'Morning briefing already sent today, skipping');
    return;
  }
  if (morningRunning) {
    logger.info({ isFallback }, 'Morning ritual already running, skipping duplicate');
    return;
  }
  morningRunning = true;
  try {
    // Gate peek BEFORE composing: if delivery would be suppressed anyway
    // (proactive disabled / daily cap), don't pay for the Sonnet composition.
    const peek = await wouldAllowProactive('morning-briefing', {
      ignoreQuietHours: true,
      ignoreCooldown: true,
    });
    if (!peek.allowed) {
      logger.info({ reason: peek.reason, isFallback }, 'Morning ritual skipped before compose (gate)');
      return;
    }

    // Reuse a same-day composition (e.g. 5:15 composed but delivery was
    // suppressed/crashed) instead of re-running the ritual + side-effect tools.
    const st2 = await ritualState.read();
    let message = st2.composedDay === today ? st2.composedMessage : undefined;
    if (!message) {
      const res = await runMorningRitual();
      if (!res.sent || !res.message) {
        logger.info({ reason: res.reason, isFallback }, 'Morning ritual produced no message');
        return;
      }
      message = res.message;
      await ritualState.update((s) => {
        s.composedDay = today;
        s.composedMessage = message;
      });
    } else {
      logger.info({ isFallback }, 'Morning ritual reusing same-day composed briefing');
    }

    // Scheduled briefing: bypass quiet hours + cooldown (once-daily wake message).
    const delivered = await emit('morning-briefing', message, deps, {
      ignoreQuietHours: true,
      ignoreCooldown: true,
    });
    // Only mark the day done if we actually delivered, so a suppressed/failed run
    // leaves the 7:00 fallback free to retry (without recomposing).
    if (delivered) {
      await ritualState.update((s) => {
        s.lastBriefingDay = today;
      });
    }
  } finally {
    morningRunning = false;
  }
}

async function checkinJob(type: string, run: () => Promise<CheckinResult>, deps: JobDeps): Promise<void> {
  // Gate peek BEFORE composing — a nudge the gate would suppress (quiet hours,
  // cap, cooldown, disabled) should never cost an LLM composition.
  const peek = await wouldAllowProactive(type);
  if (!peek.allowed) {
    logger.info({ type, reason: peek.reason }, 'Check-in skipped before compose (gate)');
    return;
  }
  const res = await run();
  if (res.sent && res.message) {
    await emit(type, res.message, deps);
  } else {
    logger.info({ type, reason: res.reason }, 'Check-in stayed silent');
  }
}

export function registerJobs(deps: JobDeps): ScheduledTask[] {
  const tasks: ScheduledTask[] = [];
  const guard = (name: string, fn: () => Promise<void>) => async () => {
    try {
      logger.info({ job: name }, 'Job firing');
      await fn();
    } catch (err) {
      logger.error({ err, job: name }, 'Job threw (contained)');
    }
  };

  // The morning rhythm is anchored to the workout time (config.workoutTime) so it
  // moves as one when WORKOUT_TIME changes. At the 05:30 default these resolve to
  // the original 5:15 / 7:00 / 8:15; at 09:30 they become 9:15 / 11:00 / 12:15.
  //   briefing      = workout hour, :15  (≈15 min before)
  //   fallback      = workout hour +2, :00 (stale-data retry)
  //   missed-check  = workout hour +3, :15 (sheet built but untouched)
  const wh = Number(config.workoutTime.split(':')[0]);
  const briefingCron = `15 ${wh} * * 1-5`;
  const fallbackCron = `0 ${(wh + 2) % 24} * * 1-5`;
  const missedCron = `15 ${(wh + 3) % 24} * * 1-5`;
  // The morning ritual REBUILDS the day's sheet (clears + rewrites), which can wipe
  // an in-progress workout, so it's behind a master switch (MORNING_RITUAL_ENABLED).
  if (config.morningRitualEnabled) {
    // M–F — morning ritual (headline).
    tasks.push(cron.schedule(briefingCron, guard('morning-briefing', () => morningRitualJob(deps)), tzOpt));
    // M–F — fallback if the first run found stale data.
    tasks.push(cron.schedule(fallbackCron, guard('morning-fallback', () => morningRitualJob(deps, true)), tzOpt));
    // M–F — missed-workout check (sheet built but untouched; reads the sheet first).
    tasks.push(cron.schedule(missedCron, guard('missed-workout', () => checkinJob('missed-workout', runMissedWorkoutCheck, deps)), tzOpt));
  } else {
    logger.warn('Morning ritual DISABLED (MORNING_RITUAL_ENABLED=false) — no auto sheet/calendar builds');
  }
  // M–F 10:30 AM — mid-morning.
  tasks.push(cron.schedule('30 10 * * 1-5', guard('mid-morning-10:30', () => checkinJob('mid-morning', runMidMorningCheck, deps)), tzOpt));
  // M–F 3:30 PM — afternoon.
  tasks.push(cron.schedule('30 15 * * 1-5', guard('afternoon-15:30', () => checkinJob('afternoon', runAfternoonCheck, deps)), tzOpt));
  // Daily 8:30 PM — evening (high bar).
  tasks.push(cron.schedule('30 20 * * *', guard('evening-20:30', () => checkinJob('evening', runEveningCheck, deps)), tzOpt));
  // Sunday 8:00 AM — weekly review (the data-rich coaching message).
  tasks.push(cron.schedule('0 8 * * 0', guard('weekly-review', () => checkinJob('weekly-review', runWeeklyReview, deps)), tzOpt));
  // Daily 11:59 PM — deterministic close: ingest the day's actual completed sets
  // into WORKOUT_DATABASE + flag data gaps (NO LLM, NO Telegram).
  tasks.push(cron.schedule('59 23 * * *', guard('daily-close-23:59', () => runDailyClose()), tzOpt));
  // Daily 9:00 AM — one-shot cost check-in (fires once on/after COST_REPORT_AFTER).
  tasks.push(cron.schedule('0 9 * * *', guard('cost-report', async () => {
    if ((await costReportState.read()).sent) return;
    if (todayStr(config.tz) < COST_REPORT_AFTER) return;
    const sent = await runCostReport(deps.deliver);
    if (sent) await costReportState.update((s) => { s.sent = true; });
  }), tzOpt));
  // Hourly at :05, 7 AM–10 PM — auto-ingest today's filled sheet into
  // WORKOUT_DATABASE so volume counts stay current WITHOUT Matt or Vic doing
  // anything (Matt's rule: filling the sheet is his only job). Ingest is now an
  // UPSERT, so re-running as he ticks more boxes corrects the rows — a partial
  // early capture never loses a later set. The 11:59 PM close is the backstop.
  tasks.push(cron.schedule('5 7-22 * * *', guard('auto-ingest', () => ingestWorkout(todayStr(config.tz)).then(() => undefined)), tzOpt));
  // Daily 11:30 PM — log today's WHOOP row into WHOOP_History (silent, deduped).
  // Independent of the morning ritual so the multi-day trend/HRV/strain signals
  // keep working with auto sheet-building off. Late on purpose: recovery is
  // scored once at wake and holds all day, but strain needs the full day to be
  // meaningful. Runs before the 11:59 PM daily close.
  tasks.push(cron.schedule('30 23 * * *', guard('whoop-sync-23:30', () => syncWhoopSnapshot().then(() => undefined)), tzOpt));
  // Daily 6:00 AM — sync latest Withings reading into BODY_COMPOSITION (silent).
  tasks.push(cron.schedule('0 6 * * *', guard('bodycomp-sync', () => syncBodyComp().then(() => undefined)), tzOpt));
  // Daily 3:30 AM — memory curation.
  tasks.push(cron.schedule('30 3 * * *', guard('curation-3:30', () => runDailyCuration()), tzOpt));
  // Hourly — self-heal: verify bridge + provider auth; alert (one-tap re-auth) on a real break.
  // Delivers directly (system alert, not coaching) — it has its own 24h-per-issue throttle.
  tasks.push(cron.schedule('0 * * * *', guard('self-heal', () => runSelfHeal(deps.deliver)), tzOpt));
  // Weekly Sun 4:00 AM — dependency security/maintenance report (only pings if findings).
  tasks.push(cron.schedule('0 4 * * 0', guard('maintenance', () => runMaintenanceReport(deps.deliver)), tzOpt));

  logger.info({ count: tasks.length, tz: config.tz }, 'Scheduled jobs registered');
  return tasks;
}
