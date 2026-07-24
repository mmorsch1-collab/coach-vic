import { runMorningRitual } from '../scheduler/morningRitual.js';
import { logger } from '../logger.js';

/**
 * Manual pre-swap test of the morning ritual against the LIVE bridge + Claude,
 * WITHOUT taking the Telegram bot. Prints the briefing it would send.
 *
 *   npm run ritual            # honors freshness gate (silent if stale)
 *   npm run ritual -- --force # run even if WHOOP data isn't fresh
 */
const force = process.argv.includes('--force');

runMorningRitual({ force })
  .then((res) => {
    if (res.sent) {
      console.log('\n===== BRIEFING THAT WOULD BE SENT =====\n');
      console.log(res.message);
      console.log('\n=======================================\n');
    } else {
      console.log(`\n[ritual stayed silent] reason: ${res.reason}\n`);
    }
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ err }, 'Ritual test failed');
    process.exit(1);
  });
