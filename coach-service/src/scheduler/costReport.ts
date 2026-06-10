import { JsonStore } from '../state/jsonStore.js';
import { logger } from '../logger.js';

/**
 * One-shot cost check-in delivered as a Coach Vic Telegram message a few days
 * after chat moved to Sonnet: real chat cost (sessionType 'main') vs the Haiku
 * equivalent (Sonnet = 3× Haiku per token), with a recommendation.
 */

interface DayUsage { mainCalls?: number; mainCost?: number }
const store = new JsonStore<{ byDate: Record<string, DayUsage> }>('usage.json', { byDate: {} });

export async function runCostReport(deliver: (text: string) => Promise<void>): Promise<boolean> {
  const s = await store.read();
  const dates = Object.keys(s.byDate).sort();
  let mainCost = 0;
  let mainCalls = 0;
  for (const d of dates) {
    mainCost += s.byDate[d].mainCost ?? 0;
    mainCalls += s.byDate[d].mainCalls ?? 0;
  }
  if (mainCalls === 0) {
    logger.info('Cost report: no chat usage recorded yet, skipping');
    return false;
  }

  const days = Math.max(1, dates.length);
  const perDay = mainCost / days;
  const monthSonnet = perDay * 30;
  const monthHaiku = monthSonnet / 3; // Sonnet is exactly 3× Haiku per token
  const delta = monthSonnet - monthHaiku;
  const rec =
    delta < 10
      ? 'My take: keep chat on Sonnet — the accuracy is worth the small premium.'
      : 'My take: worth routing routine chat to Haiku and keeping Sonnet for coaching-heavy turns.';

  const msg = [
    `📊 Cost check-in — chat's been on Sonnet for ${days} day(s):`,
    `• ${mainCalls} chat turns, $${mainCost.toFixed(2)} total (~$${(mainCost / mainCalls).toFixed(3)}/turn)`,
    `• Extrapolated: ~$${monthSonnet.toFixed(0)}/mo on Sonnet vs ~$${monthHaiku.toFixed(0)}/mo on Haiku`,
    rec,
    `Want me to switch chat back to Haiku, or route by complexity? Just say the word.`,
  ].join('\n');

  await deliver(msg);
  logger.info({ mainCost: Number(mainCost.toFixed(2)), days, mainCalls }, 'Cost report delivered');
  return true;
}
